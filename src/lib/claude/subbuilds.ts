import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { cacheHit, cacheSummary } from "./usage";
import { decodeAnswer } from "../diff/codec";
import { applyAssemblyDiff, applyDesignDiff, applyModelDiff, assemblyDiffJsonSchema, DESIGN_DIFF_INSTRUCTIONS, designDiffJsonSchema, DIFF_INSTRUCTIONS, modelDiffJsonSchema } from "../diff/diff";
import { codec } from "../diff/format";
import { designListing, modelListing } from "../prompts/edit";
import { refineWithPhoto, type RefineLog } from "./refine";
import { refineDesignPrompt, refineJsonSchema } from "../prompts/refine";
import { analysisBlock, type PhotoAnalysis, type SizeTarget } from "../prompts/analysis";
import { analyzePhoto } from "./analyze";
import type { RoundUsage } from "./usage";
import { catalogUsage, formatCatalogUsage } from "../parts/usage";
import { searchPartsTool } from "./tools";
import { z } from "zod";
import { CONFIG } from "../config";
import { BrickModelSchema, PlacementSchema, type BrickModel } from "../model/schema";
import { brickModelJsonSchema } from "../model/jsonSchema";
import { InstanceSchema, SUB_ID, type BrickDesign } from "../design/schema";
import { designEditPrompt } from "../prompts/edit";
import { compileDesign } from "../design/compile";
import { surfaceMaps } from "../design/surface";
import { systemPrompt } from "../prompts/system";
import { assemblyJsonSchema, assemblyPrompt, planJsonSchema, planPrompt, subBuildPrompt, type Plan, type PlanExtras, type PlannedSubBuild } from "../prompts/subbuilds";
import { childPlanJsonSchema, childPlanPrompt, subAssemblyPrompt, type ChildPlan } from "../prompts/tree";
import { checkChildPlan, checkTreePlan, isLibrary, PlanTree, type LibraryRef, type TreeNode } from "./tree";
import { compileSubBuild } from "../design/compile";
import { importComponent, libraryListing, loadLibrary, makeComponent, markReused, saveComponent, searchLibrary, type Library } from "../components/library";
import { libraryId } from "./tree";
import { seedRun } from "../components/seed";
import { Budget, BudgetExceeded } from "./budget";
import { costBreakdown, depthsIn, formatBreakdown, roundsIn } from "./breakdown";
import { validate, type Issue } from "../validate/validator";
import { buildSteps } from "../steps/steps";
import { DebugRun } from "./debug";
import { runLoop, type LoopResult, type RoundSummary } from "./loop";
import { loadCheckpoint, type Checkpoint, type StageCheckpoint } from "./checkpoint";
import { formatUsage, sumUsage } from "./usage";
import { getClient, invalidOutput, type GenerateEvent, type GenerateInput, type GenerateOptions, type GenerateResult } from "./generate";

/**
 * Sub-build generator: plan the model as a tree of sub-builds, design each
 * unique sub-build once (in parallel, each with its own repair loop, validated
 * on its own inside its envelope), then assemble copies plus glue parts. The
 * assembly is checked by the deterministic compiler (joins, connectivity,
 * structure) and repaired until it's valid.
 */

const PlanSchema = z.object({
  name: z.string(),
  description: z.string(),
  layout: z.string(),
  subBuilds: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      purpose: z.string(),
      w: z.number().int(),
      d: z.number().int(),
      h: z.number().int(),
      parts: z.number().int(),
      copies: z.number().int(),
      sideways: z.boolean().optional(),
      split: z.boolean().optional(),
      from: z.string().optional(),
      recolor: z.array(z.string()).optional(),
    }),
  ),
});
const ChildPlanSchema = z.object({ layout: z.string(), children: PlanSchema.shape.subBuilds });

const AssemblySchema = z.object({ name: z.string(), description: z.string(), parts: z.array(PlacementSchema), uses: z.array(InstanceSchema) });
type Assembly = z.infer<typeof AssemblySchema>;

function parseJson<T>(text: string, schema: z.ZodType<T>): { value: T | null; issues: Issue[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { value: null, issues: [invalidOutput(`Output was not valid JSON (${(e as Error).message}).`)] };
  }
  const d = decodeAnswer(json, codec());
  if (d.problems.length) return { value: null, issues: d.problems.slice(0, 20).map((m) => invalidOutput(m)) };
  const r = schema.safeParse(d.json);
  return r.success ? { value: r.data, issues: [] } : { value: null, issues: r.error.issues.slice(0, 20).map((i) => invalidOutput(`${i.path.join(".")}: ${i.message}`)) };
}

/** Plan limits (ids, envelopes, budgets). */
export function checkPlan(plan: Plan): Issue[] {
  const s = CONFIG.subbuilds;
  const out: Issue[] = [];
  const bad = (m: string) => out.push(invalidOutput(m));
  if (!plan.subBuilds.length) bad("Plan at least one sub-build.");
  if (plan.subBuilds.length > s.maxUnique) bad(`Use at most ${s.maxUnique} unique sub-builds (you planned ${plan.subBuilds.length}).`);
  const ids = new Set<string>();
  for (const b of plan.subBuilds) {
    if (!SUB_ID.test(b.id)) bad(`Sub-build id "${b.id}" must be lowercase letters, digits and _, starting with a letter.`);
    if (ids.has(b.id)) bad(`Sub-build id "${b.id}" is used twice.`);
    ids.add(b.id);
    if (b.w < 1 || b.d < 1 || b.w > s.maxEnvelope || b.d > s.maxEnvelope) bad(`${b.id}: footprint ${b.w}×${b.d} must be between 1 and ${s.maxEnvelope} studs.`);
    if (b.h < 1 || b.h > 90) bad(`${b.id}: height ${b.h} plates must be between 1 and 90.`);
    const maxParts = b.split ? CONFIG.tree.maxSplitParts : s.maxSubParts;
    if (b.parts < 3 || b.parts > maxParts) bad(`${b.id}: part budget ${b.parts} must be between 3 and ${maxParts}.`);
    if (b.copies < 1) bad(`${b.id}: plan at least one copy.`);
    if (b.sideways && b.h > 6) bad(`${b.id}: a sideways panel is at most 6 plates thick (you planned ${b.h}); its face is w × d.`);
  }
  const copies = plan.subBuilds.reduce((n, b) => n + b.copies, 0);
  if (copies > s.maxCopies) bad(`Plan at most ${s.maxCopies} copies in total (you planned ${copies}).`);
  const total = plan.subBuilds.reduce((n, b) => n + b.parts * b.copies, 0);
  if (total > CONFIG.design.maxParts - 400) bad(`Parts × copies add up to ${total}; keep it under ${CONFIG.design.maxParts - 400}.`);
  return out;
}

/**
 * Run `fn` over items with at most `n` at a time, keeping order. After a
 * failure no new item starts; the calls already running finish (their rounds
 * are saved for resume), then the first error is thrown.
 */
async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let failed: { error: unknown } | null = null;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length && !failed) {
        const i = next++;
        try {
          out[i] = await fn(items[i]);
        } catch (error) {
          failed ??= { error };
        }
      }
    }),
  );
  if (failed) throw (failed as { error: unknown }).error;
  return out;
}

/** Tree mode: asked for, or on for this Detail level (CONFIG.tree.details). */
export function useTree(input: GenerateInput): boolean {
  return input.tree ?? CONFIG.tree.details.includes(input.detail ?? "standard");
}

export interface DesignOptions extends GenerateOptions {
  /** Resume an interrupted run: reuse its valid plan and sub-builds, redo the rest. */
  checkpoint?: Checkpoint;
  /** Component library folder (default CONFIG.componentsDir), or false for none. */
  library?: string | false;
}

/** A loop result rebuilt from an earlier run's saved rounds. */
function reusedLoop<T>(cp: StageCheckpoint<T>, value: T, partCount: number): LoopResult<T> {
  return { best: { value, check: { errors: [], warnings: [], valid: true, partCount } }, rounds: cp.rounds, usage: sumUsage(cp.rounds.map((r) => r.usage)) };
}

/** Resume the sub-build run saved in `dir` (its debug folder). */
export async function resumeDesign(dir: string, onEvent: (e: GenerateEvent) => void = () => {}, opts: Omit<DesignOptions, "checkpoint"> = {}): Promise<GenerateResult> {
  const checkpoint = loadCheckpoint(dir);
  return generateDesign(checkpoint.input, onEvent, { ...opts, checkpoint });
}

/**
 * The sub-build generator, with the budget cap: when the next call would go
 * over it, the run stops, saves its valid sub-builds to the library, writes
 * stopped.json and reports how to resume it with a higher cap.
 */
export async function generateDesign(input: GenerateInput, onEvent: (e: GenerateEvent) => void = () => {}, opts: DesignOptions = {}): Promise<GenerateResult> {
  // A resumed run's earlier rounds count toward the cap: it's for the whole model.
  const spentBefore = opts.checkpoint ? roundsIn(opts.checkpoint.dir).reduce((n, r) => n + r.usage.cost, 0) : 0;
  const budget = new Budget(opts.budget ?? null, spentBefore);
  let dir = opts.checkpoint?.dir ?? "";
  try {
    return await designRun(input, (e) => (e.type === "start" && (dir = e.debugDir), onEvent(e)), opts, budget);
  } catch (e) {
    if (!(e instanceof BudgetExceeded) || !dir) throw e;
    // Calls already running finish first, so the progress line, the error and stopped.json share one total.
    await budget.idle();
    const rounds = roundsIn(dir);
    const breakdown = costBreakdown(rounds, depthsIn(dir), [], { cap: e.cap, spent: budget.spent });
    let savedComponents = 0;
    if (opts.library !== false && CONFIG.library.enabled) savedComponents = seedRun(loadLibrary(opts.library || undefined), dir);
    const resume = `npm run gen -- --resume ${path.relative(process.cwd(), dir) || dir} --budget ${Math.ceil(e.cap * 1.5)}`;
    fs.writeFileSync(path.join(/*turbopackIgnore: true*/ dir, "stopped.json"), JSON.stringify({ reason: "budget", cap: e.cap, spent: budget.spent, next: e.next, at: new Date().toISOString(), savedComponents, resume, breakdown }, null, 1));
    console.log(`[generate] budget cap $${e.cap.toFixed(2)} reached: spent $${budget.spent.toFixed(2)}; ${e.next.scope} (~$${e.next.estimate.toFixed(2)}) didn't start. ${formatBreakdown(breakdown)}`);
    onEvent({ type: "budget", cap: e.cap, spent: budget.spent, next: e.next, resume, savedComponents });
    const err = new BudgetExceeded(e.cap, budget.spent, e.next);
    err.message = `${err.message} Finished stages are saved${savedComponents ? ` (${savedComponents} valid sub-builds added to the component library)` : ""}. Resume with a higher cap: ${resume}`;
    throw err;
  }
}

async function designRun(input: GenerateInput, onEvent: (e: GenerateEvent) => void, opts: DesignOptions, budget: Budget): Promise<GenerateResult> {
  if (!input.text?.trim() && !input.image) throw new Error("Provide a description or a photo.");
  const anthropic = opts.client ?? getClient();
  const cp = opts.checkpoint;
  const debug = cp ? DebugRun.open(cp.dir) : new DebugRun(`subbuilds-${input.text?.trim() || "photo"}`);
  onEvent({ type: "start", debugDir: debug.dir });
  const system = systemPrompt();
  const fmt = codec();
  if (!cp) {
    debug.write("input.json", { mode: "build", pipeline: "subbuilds", text: input.text ?? null, detail: input.detail ?? null, hasImage: !!input.image, tree: useTree(input), config: CONFIG });
    debug.write("system-prompt.md", system);
    if (input.image) debug.writeBinary(`input-image.${input.image.mediaType.split("/")[1]}`, Buffer.from(input.image.data, "base64"));
  }
  // Rounds from the interrupted run whose stage is redone now still count toward the total cost.
  const earlierRounds: RoundSummary[] = [];
  const ctx = { anthropic, debug, onEvent, signal: opts.signal, budget };
  const withImage = (text: string): Anthropic.MessageParam["content"] =>
    input.image
      ? [
          { type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.data } },
          { type: "text", text },
        ]
      : text;

  // --- 0. photo analysis (photos only; reused on resume) ------------------------------------
  let photo: { analysis: PhotoAnalysis; target: SizeTarget; rounds: RoundSummary[]; usage: RoundUsage } | null = null;
  if (input.image) {
    onEvent({ type: "stage", scope: "analysis", label: "Reading the photo", status: "start" });
    if (cp?.analysis) {
      const rounds = cp.analysis.rounds.map((r) => ({ ...r, reused: true }));
      photo = { analysis: cp.analysis.analysis, target: cp.analysis.target, rounds, usage: sumUsage(rounds.map((r) => r.usage)) };
    } else photo = await analyzePhoto({ text: input.text, image: input.image, detail: input.detail }, CONFIG.design.grid, ctx);
    onEvent({ type: "analysis", analysis: photo.analysis, target: photo.target, cost: photo.usage.cost });
    onEvent({ type: "stage", scope: "analysis", label: "Reading the photo", status: "done", valid: true, cost: photo.usage.cost });
  }

  // --- 1. plan --------------------------------------------------------------------------
  const tree = useTree(input);
  const lib: Library | null = opts.library === false || !CONFIG.library.enabled ? null : loadLibrary(opts.library || undefined);
  const libraryRefs = new Map<string, LibraryRef>((lib?.components ?? []).map((c) => [c.id, { id: c.id, ...c.size, parts: c.parts, depth: c.depth }]));
  const request = input.text ?? "";
  const topQuery = [request, photo?.analysis.subject ?? "", ...(photo?.analysis.keyFeatures ?? [])].join(" ");
  const offered = lib ? libraryListing(searchLibrary(lib, topQuery, { w: CONFIG.subbuilds.maxEnvelope, d: CONFIG.subbuilds.maxEnvelope, h: 90 })) : [];
  const extras: PlanExtras = { tree, library: offered };
  if (offered.length) console.log(`[generate] library: offering ${offered.length} of ${lib!.components.length} components to the plan`);
  onEvent({ type: "stage", scope: "plan", label: "Planning sub-builds", status: "start" });
  const planText = planPrompt(input.text ?? "", input.detail, !!input.image, photo ? analysisBlock(photo.analysis, photo.target) : undefined, extras);
  if (cp && !cp.plan.valid) earlierRounds.push(...cp.plan.rounds);
  const planLoop = cp?.plan.valid ? reusedLoop(cp.plan, cp.plan.valid, 0) : await runLoop<Plan>(
    {
      scope: "plan",
      stage: "plan",
      // Its own schema (no other call shares the cached prefix) and usually one call.
      cache: false,
      debugPrefix: "plan.",
      system,
      firstContent: withImage(planText),
      firstText: planText,
      schema: planJsonSchema(extras),
      parse: (t) => parseJson(t, PlanSchema),
      check: (plan) => {
        const errors = [...checkPlan(plan), ...(tree || libraryRefs.size ? checkTreePlan(plan, libraryRefs) : [])];
        if (!tree) errors.push(...plan.subBuilds.filter((b) => b.split).map((b) => invalidOutput(`${b.id}: split isn't available here; design it directly.`)));
        return { errors, warnings: [], valid: !errors.length, partCount: plan.subBuilds.reduce((n, b) => n + b.parts * b.copies, 0) };
      },
      maxRepairRounds: CONFIG.subbuilds.planRepairRounds,
    },
    ctx,
  );
  const plan = planLoop.best?.check.valid ? planLoop.best.value : null;
  onEvent({ type: "stage", scope: "plan", label: "Planning sub-builds", status: "done", valid: !!plan, parts: plan?.subBuilds.length, cost: planLoop.usage.cost });
  if (!plan) throw new Error("Couldn't make a valid sub-build plan; see the debug folder.");
  debug.write("plan.json", plan);

  /** A stage from the interrupted run: reused if it passed, otherwise its rounds count as earlier cost and it's run again. */
  const reuseOr = async <T,>(prefix: string, parse: (raw: unknown) => T | null, partCount: (v: T) => number, run: () => Promise<LoopResult<T>>): Promise<LoopResult<T>> => {
    const saved = cp?.stage(prefix, parse);
    if (saved?.valid) return reusedLoop(saved, saved.valid, partCount(saved.valid));
    if (saved) earlierRounds.push(...saved.rounds);
    return run();
  };

  // --- 1b. tree: plan each split sub-build as child sub-builds, level by level ------------------
  const ptree = new PlanTree(plan);
  const childLoops: { node: TreeNode; loop: LoopResult<ChildPlan> }[] = [];
  let offeredChild = 0;
  for (let depth = 1; tree && depth < CONFIG.tree.maxDepth; depth++) {
    const level = ptree.unplanned(depth);
    if (!level.length) break;
    // At the unique limit already: the rest are designed directly.
    if (ptree.nodes.size >= CONFIG.tree.maxUnique) {
      for (const node of level) (node.split = false), (node.parts = Math.min(node.parts, CONFIG.subbuilds.maxSubParts));
      console.log(`[generate] ${ptree.nodes.size} unique sub-builds: designing ${level.map((n) => n.id).join(", ")} directly`);
      break;
    }
    // Plans of one level run in parallel: each is checked against what the whole tree has left,
    // and its prompt suggests a fair share of the new unique sub-builds.
    const uniqueLeft = CONFIG.tree.maxUnique - ptree.nodes.size;
    const uniqueShare = Math.max(1, Math.ceil(uniqueLeft / level.length));
    const copiesLeft = Math.max(0, CONFIG.tree.maxCopies - ptree.copies());
    const shared = ptree.leaves().map((n) => ({ ...n, copies: 1 }));
    const results = await pool(level, CONFIG.subbuilds.concurrency, async (node) => {
      const scope = `plan:${node.id}`;
      onEvent({ type: "stage", scope, label: node.name, status: "start", copies: ptree.totalCopies(node.id), depth: node.depth });
      const ctxT = ptree.context(node.id) ?? { path: [], siblings: plan.subBuilds };
      const offer = lib ? libraryListing(searchLibrary(lib, `${node.name} ${node.purpose} ${node.id.replace(/_/g, " ")}`, node)) : [];
      offeredChild += offer.length;
      const text = childPlanPrompt(plan, node, ctxT, { depth: node.depth, shared, library: offer, uniqueLeft, uniqueShare: Math.min(uniqueShare, uniqueLeft) });
      const loop = await reuseOr(`plan-${node.id}.`, (raw) => { const r = ChildPlanSchema.safeParse(raw); return r.success ? r.data : null; }, (c) => c.children.length, () =>
        runLoop<ChildPlan>(
          {
            scope,
            stage: "subPlan",
            cache: false,
            debugPrefix: `plan-${node.id}.`,
            system,
            firstContent: text,
            firstText: text,
            schema: childPlanJsonSchema(),
            parse: (t) => parseJson(t, ChildPlanSchema),
            check: (c) => {
              const errors = checkChildPlan(ptree, node, c, { library: libraryRefs, uniqueLeft, copiesLeft });
              return { errors, warnings: [], valid: !errors.length, partCount: c.children.reduce((n, x) => n + x.parts * x.copies, 0) };
            },
            maxRepairRounds: CONFIG.subbuilds.planRepairRounds,
          },
          ctx,
        ),
      );
      const valid = loop.best?.check.valid ?? false;
      onEvent({ type: "stage", scope, label: node.name, status: "done", valid, parts: valid ? loop.best!.value.children.length : 0, copies: ptree.totalCopies(node.id), cost: loop.usage.cost, depth: node.depth });
      return { node, loop };
    });
    childLoops.push(...results);
    // A split sub-build without a valid child plan is designed directly instead.
    for (const { node, loop } of results) {
      if (loop.best?.check.valid) continue;
      node.split = false;
      node.parts = Math.min(node.parts, CONFIG.subbuilds.maxSubParts);
      console.log(`[generate] ${node.id}: no valid child plan, designing it directly`);
    }
    ptree.addLevel(results.filter((r) => r.loop.best?.check.valid).map((r) => ({ parent: r.node.id, child: r.loop.best!.value })));
    debug.write("tree.json", { depth: ptree.depth(), unique: ptree.nodes.size, copies: ptree.copies(), nodes: [...ptree.nodes.values()] });
  }
  if (tree) debug.write("tree.json", { depth: ptree.depth(), unique: ptree.nodes.size, copies: ptree.copies(), nodes: [...ptree.nodes.values()] });

  // --- 2. sub-builds designed directly, in parallel ------------------------------------------------
  // The first request goes alone until it starts streaming (its prompt is cached by then);
  // the rest then read the cache instead of all writing it at once.
  let firstStarted!: () => void;
  const cacheWarm = new Promise<void>((r) => (firstStarted = r));
  const leaves = ptree.leaves();
  const needCalls = leaves.filter((s) => !cp?.subs.get(s.id)?.valid);
  if (!needCalls.length) firstStarted();
  const subLoops = await pool(leaves, CONFIG.subbuilds.concurrency, async (node) => {
    const scope = `sub:${node.id}`;
    const copies = ptree.totalCopies(node.id);
    const ctxT = ptree.context(node.id);
    // Tree leaves are told their copies per copy of their parent; top-level ones their total, as before.
    const sub: PlannedSubBuild = ctxT ? { ...node, copies: ctxT.siblings.find((x) => x.id === node.id)!.copies } : node;
    onEvent({ type: "stage", scope, label: node.name, status: "start", copies, ...(tree ? { depth: node.depth } : {}) });
    const text = subBuildPrompt(plan, sub, ctxT);
    const saved = cp?.subs.get(node.id);
    if (saved?.valid) {
      const loop = reusedLoop(saved, saved.valid, saved.valid.parts.length);
      onEvent({ type: "stage", scope, label: node.name, status: "done", valid: true, parts: saved.valid.parts.length, copies, cost: loop.usage.cost, ...(tree ? { depth: node.depth } : {}) });
      return { sub: node, loop };
    }
    if (saved) earlierRounds.push(...saved.rounds);
    const first = node === needCalls[0];
    if (!first) await cacheWarm;
    const loop = await runLoop<BrickModel>(
      {
        scope,
        stage: "subBuild",
        debugPrefix: `sub-${node.id}.`,
        system,
        firstContent: text,
        firstText: text,
        schema: brickModelJsonSchema(),
        tools: [searchPartsTool],
        parse: (t) => parseJson(t, BrickModelSchema),
        diff: { schema: modelDiffJsonSchema(fmt), apply: (prev, json) => applyModelDiff(prev, json, fmt), listing: (m) => modelListing(m, fmt), instructions: DIFF_INSTRUCTIONS },
        check: (model, last) => {
          const v = validate(model, { grid: { x: node.w, z: node.d, y: node.h }, maxParts: Math.min(CONFIG.maxParts, Math.ceil(node.parts * 1.6) + 10), structure: last ? "warn" : "error" });
          return { errors: v.errors, warnings: v.warnings, valid: v.valid, partCount: model.parts.length };
        },
      },
      first ? { ...ctx, onStarted: firstStarted } : ctx,
    ).finally(() => first && firstStarted());
    onEvent({ type: "stage", scope, label: node.name, status: "done", valid: loop.best?.check.valid ?? false, parts: loop.best?.value.parts.length ?? 0, copies, cost: loop.usage.cost, ...(tree ? { depth: node.depth } : {}) });
    return { sub: node, loop };
  });
  const built = subLoops.filter((s) => s.loop.best).map(({ sub, loop }) => ({ sub, model: loop.best!.value, valid: loop.best!.check.valid }));
  if (!built.length && ![...ptree.nodes.values()].some((n) => isLibrary(n.from))) throw new Error("None of the sub-builds could be designed; see the debug folder.");
  const subBuilds: BrickDesign["subBuilds"] = built.map(({ sub, model }) => ({ id: sub.id, name: sub.name, parts: model.parts, uses: [] }));
  debug.write("subbuilds.json", subBuilds);

  // --- 2a. components reused from the library -------------------------------------------------------
  const reused: { node: string; component: string; name: string; copies: number; recolor: string[]; saved: number }[] = [];
  const imported = new Set<string>();
  for (const node of [...ptree.nodes.values()].filter((n) => isLibrary(n.from))) {
    const comp = lib?.byId.get(libraryId(node.from));
    if (!comp) continue;
    const add = importComponent(comp, node.id, node.recolor ?? [], subBuilds, [...ptree.nodes.keys()]);
    subBuilds.push(...add);
    add.forEach((s) => imported.add(s.id));
    node.sideways = comp.sideways;
    const copies = ptree.totalCopies(node.id);
    reused.push({ node: node.id, component: comp.id, name: comp.name, copies, recolor: node.recolor ?? [], saved: comp.cost });
    markReused(lib!, comp.id);
    console.log(`[generate] library: reused ${comp.id} as ${node.id} ×${copies}${node.recolor?.length ? ` (recoloured ${node.recolor.join(", ")})` : ""}, saves ~$${comp.cost.toFixed(2)}`);
    onEvent({ type: "stage", scope: `lib:${node.id}`, label: node.name, status: "done", valid: true, parts: comp.parts, copies, cost: 0, ...(tree ? { depth: node.depth } : {}), reused: { component: comp.id, saved: comp.cost, ...(node.recolor?.length ? { recolor: node.recolor } : {}) } });
  }

  /** A finished sub-build as one flat model at the origin (a split one compiled from its children). */
  const flatModel = (id: string): BrickModel | null => {
    const leaf = built.find((b) => b.sub.id === id);
    if (leaf) return leaf.model;
    if (!subBuilds.some((s) => s.id === id)) return null;
    return compileSubBuild({ name: id, description: "", subBuilds, main: { parts: [], uses: [] } }, id, { structure: "off" }).model;
  };
  /** A sub-build and every sub-build inside it. */
  const subtree = (id: string, out = new Map<string, BrickDesign["subBuilds"][number]>()) => {
    const s = subBuilds.find((x) => x.id === id);
    if (!s || out.has(id)) return out;
    out.set(id, s);
    for (const u of s.uses) subtree(u.sub, out);
    return out;
  };

  // --- 2b. tree: assemble each split sub-build from its children, deepest first ---------------------
  const asmLoops: { node: TreeNode; loop: LoopResult<Assembly> }[] = [];
  const splits = ptree.splits();
  for (const depth of [...new Set(splits.map((n) => n.depth))]) {
    const level = splits.filter((n) => n.depth === depth);
    const results = await pool(level, CONFIG.subbuilds.concurrency, async (node) => {
      const scope = `asm:${node.id}`;
      const copies = ptree.totalCopies(node.id);
      onEvent({ type: "stage", scope, label: node.name, status: "start", copies, depth: node.depth });
      const kids = ptree.childrenOf(node.id).flatMap((c) => {
        const m = flatModel(c.id);
        return m ? [{ id: c.id, name: c.name, copies: c.uses.find((u) => u.parent === node.id)!.copies, parts: m.parts.length, maps: surfaceMaps(m), sideways: CONFIG.sideways.enabled && c.sideways }] : [];
      });
      const text = subAssemblyPrompt(plan, node, node.child!, ptree.context(node.id) ?? { path: [], siblings: [] }, kids);
      const kidIds = kids.map((k) => k.id);
      const designFor = (a: Assembly): BrickDesign => {
        const inside = new Map<string, BrickDesign["subBuilds"][number]>();
        for (const id of kidIds) subtree(id, inside);
        return { name: node.name, description: a.description, subBuilds: [...inside.values(), { id: node.id, name: node.name, parts: a.parts, uses: a.uses }], main: { parts: [], uses: [] } };
      };
      const small = node.parts <= CONFIG.tree.smallAssembly;
      const loop = await reuseOr(`asm-${node.id}.`, (raw) => { const r = AssemblySchema.safeParse(raw); return r.success ? r.data : null; }, () => 0, () =>
        runLoop<Assembly>(
          {
            scope,
            stage: small ? "subAssembly" : "assembly",
            debugPrefix: `asm-${node.id}.`,
            system,
            firstContent: text,
            firstText: text,
            schema: assemblyJsonSchema(),
            tools: [searchPartsTool],
            parse: (t) => parseJson(t, AssemblySchema),
            diff: {
              schema: assemblyDiffJsonSchema(fmt),
              apply: (prev, json) => applyAssemblyDiff(prev, json, fmt),
              listing: (a) => designListing({ name: a.name, description: a.description, subBuilds: [], main: { parts: a.parts, uses: a.uses } }),
              instructions: `Return only the changes to this sub-build: remove / set / add for its parts and removeCopies / setCopies / addCopies for its copies, by index into the listing above (before your changes). Leave the name and description empty to keep them. Everything you don't mention stays as it is.`,
            },
            check: (a, last) => {
              const c = compileSubBuild(designFor(a), node.id, { grid: { x: node.w, z: node.d, y: node.h }, structure: last ? "warn" : "error" });
              return { errors: c.errors, warnings: c.warnings, valid: !c.errors.length, partCount: c.stats.pieces };
            },
          },
          ctx,
        ),
      );
      onEvent({ type: "stage", scope, label: node.name, status: "done", valid: loop.best?.check.valid ?? false, parts: loop.best?.check.partCount, copies, cost: loop.usage.cost, depth: node.depth });
      return { node, loop };
    });
    asmLoops.push(...results);
    for (const { node, loop } of results) if (loop.best) subBuilds.push({ id: node.id, name: node.name, parts: loop.best.value.parts, uses: loop.best.value.uses });
  }

  // --- 3. assembly ------------------------------------------------------------------------
  onEvent({ type: "stage", scope: "assembly", label: "Assembling", status: "start" });
  const top = plan.subBuilds.flatMap((sub) => {
    const node = ptree.get(sub.id);
    const model = flatModel(sub.id);
    return model ? [{ id: sub.id, name: sub.name, copies: sub.copies, parts: model.parts.length, maps: surfaceMaps(model), sideways: CONFIG.sideways.enabled && node.sideways }] : [];
  });
  const aText = assemblyPrompt(request, plan, top);
  const designOf = (a: Assembly): BrickDesign => ({ name: a.name, description: a.description, subBuilds, main: { parts: a.parts, uses: a.uses } });
  const savedAssembly = cp?.assembly.valid ? AssemblySchema.safeParse(cp.assembly.valid) : null;
  if (cp && !savedAssembly?.success) earlierRounds.push(...cp.assembly.rounds);
  const assembly = savedAssembly?.success ? reusedLoop<Assembly>({ rounds: cp!.assembly.rounds, valid: savedAssembly.data }, savedAssembly.data, 0) : await runLoop<Assembly>(
    {
      scope: "assembly",
      stage: "assembly",
      debugPrefix: "assembly.",
      system,
      firstContent: withImage(aText),
      firstText: aText,
      schema: assemblyJsonSchema(),
      tools: [searchPartsTool],
      parse: (t) => parseJson(t, AssemblySchema),
      diff: {
        schema: assemblyDiffJsonSchema(fmt),
        apply: (prev, json) => applyAssemblyDiff(prev, json, fmt),
        listing: (a) => designListing({ name: a.name, description: a.description, subBuilds: [], main: { parts: a.parts, uses: a.uses } }),
        instructions: `Return only the changes to the main build: remove / set / add for its parts and removeCopies / setCopies / addCopies for its copies, by index into the listing above (before your changes). Leave the name and description empty to keep them. Everything you don't mention stays as it is.`,
      },
      check: (a, last) => {
        const c = compileDesign(designOf(a), { structure: last ? "warn" : "error" });
        return { errors: c.errors, warnings: c.warnings, valid: !c.errors.length, partCount: c.stats.pieces };
      },
    },
    ctx,
  );
  const a = assembly.best?.value;
  onEvent({ type: "stage", scope: "assembly", label: "Assembling", status: "done", valid: assembly.best?.check.valid ?? false, parts: assembly.best?.check.partCount, cost: assembly.usage.cost });

  // --- result -------------------------------------------------------------------------------
  const rounds = [...(photo?.rounds ?? []), ...earlierRounds, ...planLoop.rounds, ...childLoops.flatMap((s) => s.loop.rounds), ...subLoops.flatMap((s) => s.loop.rounds), ...asmLoops.flatMap((s) => s.loop.rounds), ...assembly.rounds];
  let design = a ? designOf(a) : null;

  // Photo builds: compare renders with the photo and refine the design (valid designs only).
  let refine: { usage: RoundUsage; log: RefineLog[] } | null = null;
  if (photo && input.image && design && assembly.best?.check.valid && CONFIG.refine.rounds > 0) {
    const r = await refineWithPhoto<BrickDesign>(
      {
        photo: input.image,
        analysis: photo.analysis,
        target: photo.target,
        initial: design,
        toModel: (d) => compileDesign(d, { structure: "off" }).model,
        prompt: (d, round, n) => refineDesignPrompt(photo!.analysis, photo!.target, d, compileDesign(d, { structure: "off" }).stats.pieces, round, n),
        schema: refineJsonSchema(designDiffJsonSchema(fmt)),
        applyChanges: (base, changes) => applyDesignDiff(base, changes, fmt),
        listing: (d) => designListing(d),
        instructions: DESIGN_DIFF_INSTRUCTIONS,
        check: (d, last) => {
          const c = compileDesign(d, { structure: last ? "warn" : "error" });
          return { errors: c.errors, warnings: c.warnings, valid: !c.errors.length, partCount: c.stats.pieces };
        },
        system,
        tools: [searchPartsTool],
      },
      ctx,
      onEvent,
    );
    rounds.push(...r.rounds);
    refine = { usage: r.usage, log: r.log };
    design = r.value;
  }

  // Component library: save every valid sub-build this run designed (not the reused ones).
  const added: string[] = [];
  if (lib) {
    const finalSubs = design?.subBuilds ?? subBuilds;
    const own = new Map<string, number>();
    const addCost = (id: string, c: number) => own.set(id, (own.get(id) ?? 0) + c);
    for (const { sub, loop } of subLoops) addCost(sub.id, loop.usage.cost);
    for (const { node, loop } of [...childLoops, ...asmLoops]) addCost(node.id, loop.usage.cost);
    const costOf = (id: string, seen = new Set<string>()): number => {
      if (seen.has(id)) return 0;
      seen.add(id);
      return (own.get(id) ?? 0) + (finalSubs.find((x) => x.id === id)?.uses ?? []).reduce((n, u) => n + costOf(u.sub, seen), 0);
    };
    for (const sb of finalSubs) {
      if (imported.has(sb.id)) continue;
      const node = ptree.nodes.get(sb.id);
      const comp = makeComponent(finalSubs, sb.id, {
        description: node?.purpose,
        context: [...(ptree.nodes.has(sb.id) ? (ptree.context(sb.id)?.path ?? []).map((p) => p.name) : []), plan.name, request],
        sideways: node?.sideways,
        cost: costOf(sb.id),
        run: debug.dir.split(/[\\/]/).pop(),
        request,
      });
      if (comp && saveComponent(lib, comp).added) added.push(comp.id);
    }
    if (added.length || reused.length) console.log(`[generate] library: ${reused.length} reused (${reused.reduce((n, r) => n + r.copies, 0)} copies, ~$${reused.reduce((n, r) => n + r.saved, 0).toFixed(2)} saved), ${added.length} new components saved (${lib.components.length} in the library)`);
  }

  const usage = sumUsage(rounds.map((r) => r.usage));
  const spentNow = sumUsage(rounds.filter((r) => !r.reused).map((r) => r.usage));
  const compiled = design ? compileDesign(design, { structure: assembly.best!.check.valid ? "warn" : "error" }) : null;
  const result: GenerateResult = {
    model: compiled?.model ?? null,
    valid: !!compiled && compiled.errors.length === 0,
    validation: compiled?.validation
      ? { errors: compiled.errors, warnings: compiled.warnings, components: compiled.validation.components, connections: compiled.validation.connections }
      : null,
    steps: compiled ? buildSteps(compiled.model) : [],
    rounds,
    usage,
    debugDir: debug.dir,
    design: design ?? undefined,
    compile: compiled ? { stats: compiled.stats, tree: compiled.tree, subBuilds: compiled.subBuilds } : undefined,
    pipeline: "subbuilds",
    ...(photo ? { analysis: { analysis: photo.analysis, target: photo.target, cost: photo.usage.cost } } : {}),
    ...(refine ? { refine: refine.log } : {}),
    ...(lib ? { library: { reused: reused.length, copies: reused.reduce((n, r) => n + r.copies, 0), saved: reused.reduce((n, r) => n + r.saved, 0), added: added.length } } : {}),
    costBreakdown: costBreakdown(rounds, (id) => ptree.nodes.get(id)?.depth ?? 1, reused, { cap: budget.cap, spent: budget.spent }),
  };
  const stages = {
    ...(photo ? { analysis: { subject: photo.analysis.subject, target: photo.target, rounds: photo.rounds.length, cost: photo.usage.cost } } : {}),
    plan: { rounds: planLoop.rounds.length, cost: planLoop.usage.cost },
    subBuilds: subLoops.map(({ sub, loop }) => ({ id: sub.id, name: sub.name, copies: ptree.totalCopies(sub.id), parts: loop.best?.value.parts.length ?? 0, valid: loop.best?.check.valid ?? false, rounds: loop.rounds.length, cost: loop.usage.cost })),
    ...(tree
      ? {
          childPlans: childLoops.map(({ node, loop }) => ({ id: node.id, name: node.name, depth: node.depth, children: loop.best?.check.valid ? loop.best.value.children.length : 0, valid: loop.best?.check.valid ?? false, rounds: loop.rounds.length, cost: loop.usage.cost })),
          subAssemblies: asmLoops.map(({ node, loop }) => ({ id: node.id, name: node.name, depth: node.depth, copies: ptree.totalCopies(node.id), parts: loop.best?.check.partCount ?? 0, valid: loop.best?.check.valid ?? false, rounds: loop.rounds.length, cost: loop.usage.cost, stage: node.parts <= CONFIG.tree.smallAssembly ? "subAssembly" : "assembly" })),
          tree: { depth: ptree.depth(), unique: ptree.nodes.size, copies: ptree.copies() },
        }
      : {}),
    assembly: { rounds: assembly.rounds.length, cost: assembly.usage.cost, valid: assembly.best?.check.valid ?? false },
    ...(refine ? { refine: { rounds: refine.log, cost: refine.usage.cost } } : {}),
  };
  const resumed = cp
    ? {
        reused: { plan: !!cp.plan.valid, subBuilds: subLoops.filter(({ loop }) => loop.rounds.every((r) => r.reused)).map(({ sub }) => sub.id), assembly: !!savedAssembly?.success },
        costBefore: sumUsage(rounds.filter((r) => r.reused).map((r) => r.usage)).cost,
        costNow: spentNow.cost,
      }
    : undefined;
  if (resumed) debug.write(`resume-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, resumed);
  const catalog = catalogUsage(result.model);
  console.log(`[generate] ${formatCatalogUsage(catalog)}`);
  const library = lib ? { offered: { plan: offered.length, childPlans: offeredChild }, reused, savedCost: reused.reduce((n, r) => n + r.saved, 0), added, size: lib.components.length } : undefined;
  console.log(`[generate] cost: ${formatBreakdown(result.costBreakdown!)}`);
  debug.write("summary.json", { pipeline: "subbuilds", valid: result.valid, stages, ...(library ? { library } : {}), costBreakdown: result.costBreakdown, rounds, total: usage, cache: cacheSummary(usage), ...(resumed ? { resumed } : {}), partCount: result.model?.parts.length ?? 0, compile: compiled?.stats, catalog });
  if (design) debug.write("final-design.json", design);
  if (result.model) debug.write("final-model.json", result.model);
  if (resumed) console.log(`[generate] resumed: reused plan=${resumed.reused.plan}, sub-builds [${resumed.reused.subBuilds.join(", ")}], assembly=${resumed.reused.assembly}; earlier $${resumed.costBefore.toFixed(4)}, now $${resumed.costNow.toFixed(4)}`);
  console.log(`[generate] sub-builds done: valid=${result.valid}, ${result.model?.parts.length ?? 0} parts, ${compiled?.stats.copies ?? 0} copies, ${rounds.length} round(s) · total ${formatUsage(usage)} · cache hit ${cacheHit(usage)} · debug: ${debug.dir}`);
  onEvent({ type: "done", result });
  return result;
}

// ---- design edits ------------------------------------------------------------------------

/**
 * Chat edit of a model that has a sub-build design: Claude gets the design
 * (each sub-build once) and returns the whole updated design, which is compiled
 * and repaired like an assembly. Changing a sub-build changes every copy.
 */
export async function editDesign(input: GenerateInput & { baseDesign: BrickDesign }, onEvent: (e: GenerateEvent) => void = () => {}, opts: GenerateOptions = {}): Promise<GenerateResult> {
  if (!input.text?.trim() && !input.image) throw new Error("Describe the change you want.");
  const anthropic = opts.client ?? getClient();
  const debug = new DebugRun(`edit-${input.text?.trim() || "photo"}`);
  onEvent({ type: "start", debugDir: debug.dir });
  const system = systemPrompt();
  const fmt = codec();
  debug.write("input.json", { mode: "edit", pipeline: "design-edit", text: input.text ?? null, hasImage: !!input.image, config: CONFIG });
  debug.write("base-design.json", input.baseDesign);
  debug.write("system-prompt.md", system);
  const text = designEditPrompt(input.baseDesign, input.text ?? "", !!input.image);
  const content: Anthropic.MessageParam["content"] = input.image
    ? [
        { type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.data } },
        { type: "text", text },
      ]
    : text;

  onEvent({ type: "stage", scope: "edit", label: "Editing the design", status: "start" });
  const loop = await runLoop<BrickDesign>(
    {
      scope: "edit",
      stage: "edit",
      debugPrefix: "edit.",
      system,
      firstContent: content,
      firstText: text,
      // The edit returns only the changes, applied to the base design (repairs too).
      schema: designDiffJsonSchema(fmt),
      tools: [searchPartsTool],
      parse: (t) => {
        try {
          return applyDesignDiff(input.baseDesign, JSON.parse(t), fmt);
        } catch (e) {
          return { value: null, issues: [{ code: "INVALID_OUTPUT" as const, severity: "error" as const, parts: [], message: `Output was not valid JSON (${(e as Error).message}).` }] };
        }
      },
      diff: { schema: designDiffJsonSchema(fmt), apply: (prev, json) => applyDesignDiff(prev, json, fmt), listing: (d) => designListing(d), instructions: DESIGN_DIFF_INSTRUCTIONS },
      check: (d, last) => {
        const c = compileDesign(d, { structure: last ? "warn" : "error" });
        return { errors: c.errors, warnings: c.warnings, valid: !c.errors.length, partCount: c.stats.pieces };
      },
    },
    { anthropic, debug, onEvent, signal: opts.signal, ...(opts.budget !== undefined ? { budget: new Budget(opts.budget) } : {}) },
  );
  const design = loop.best?.value ?? null;
  onEvent({ type: "stage", scope: "edit", label: "Editing the design", status: "done", valid: loop.best?.check.valid ?? false, parts: loop.best?.check.partCount, cost: loop.usage.cost });
  const compiled = design ? compileDesign(design, { structure: loop.best!.check.valid ? "warn" : "error" }) : null;
  const result: GenerateResult = {
    model: compiled?.model ?? null,
    valid: !!compiled && compiled.errors.length === 0,
    validation: compiled?.validation ? { errors: compiled.errors, warnings: compiled.warnings, components: compiled.validation.components, connections: compiled.validation.connections } : null,
    steps: compiled ? buildSteps(compiled.model) : [],
    rounds: loop.rounds,
    usage: loop.usage,
    debugDir: debug.dir,
    design: design ?? undefined,
    compile: compiled ? { stats: compiled.stats, tree: compiled.tree, subBuilds: compiled.subBuilds } : undefined,
    pipeline: "subbuilds",
  };
  const catalog = catalogUsage(result.model);
  console.log(`[generate] ${formatCatalogUsage(catalog)}`);
  debug.write("summary.json", { pipeline: "design-edit", valid: result.valid, rounds: loop.rounds, total: loop.usage, partCount: result.model?.parts.length ?? 0, compile: compiled?.stats, catalog });
  if (design) debug.write("final-design.json", design);
  if (result.model) debug.write("final-model.json", result.model);
  console.log(`[generate] design edit done: valid=${result.valid}, ${result.model?.parts.length ?? 0} parts · ${formatUsage(loop.usage)} · debug: ${debug.dir}`);
  onEvent({ type: "done", result });
  return result;
}
