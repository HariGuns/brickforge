import type Anthropic from "@anthropic-ai/sdk";
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
import { PART_IDS } from "../parts/library";
import { COLOR_IDS } from "../parts/colors";
import { BrickModelSchema, PlacementSchema, type BrickModel } from "../model/schema";
import { brickModelJsonSchema } from "../model/jsonSchema";
import { InstanceSchema, SUB_ID, type BrickDesign } from "../design/schema";
import { designEditPrompt } from "../prompts/edit";
import { compileDesign } from "../design/compile";
import { surfaceMaps } from "../design/surface";
import { systemPrompt } from "../prompts/system";
import { assemblyJsonSchema, assemblyPrompt, planJsonSchema, planPrompt, subBuildPrompt, type Plan } from "../prompts/subbuilds";
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
    }),
  ),
});

const AssemblySchema = z.object({ name: z.string(), description: z.string(), parts: z.array(PlacementSchema), uses: z.array(InstanceSchema) });
type Assembly = z.infer<typeof AssemblySchema>;

function parseJson<T>(text: string, schema: z.ZodType<T>): { value: T | null; issues: Issue[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { value: null, issues: [invalidOutput(`Output was not valid JSON (${(e as Error).message}).`)] };
  }
  const r = schema.safeParse(json);
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
    if (b.parts < 3 || b.parts > s.maxSubParts) bad(`${b.id}: part budget ${b.parts} must be between 3 and ${s.maxSubParts}.`);
    if (b.copies < 1) bad(`${b.id}: plan at least one copy.`);
  }
  const copies = plan.subBuilds.reduce((n, b) => n + b.copies, 0);
  if (copies > s.maxCopies) bad(`Plan at most ${s.maxCopies} copies in total (you planned ${copies}).`);
  const total = plan.subBuilds.reduce((n, b) => n + b.parts * b.copies, 0);
  if (total > CONFIG.design.maxParts - 400) bad(`Parts × copies add up to ${total}; keep it under ${CONFIG.design.maxParts - 400}.`);
  return out;
}

/** Run `fn` over items with at most `n` at a time, keeping order. */
async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export interface DesignOptions extends GenerateOptions {
  /** Resume an interrupted run: reuse its valid plan and sub-builds, redo the rest. */
  checkpoint?: Checkpoint;
}

/** A loop result rebuilt from an earlier run's saved rounds. */
function reusedLoop<T>(cp: StageCheckpoint<T>, value: T, partCount: number): LoopResult<T> {
  return { best: { value, check: { errors: [], warnings: [], valid: true, partCount } }, rounds: cp.rounds, usage: sumUsage(cp.rounds.map((r) => r.usage)) };
}

/** Resume the sub-build run saved in `dir` (its debug folder). */
export async function resumeDesign(dir: string, onEvent: (e: GenerateEvent) => void = () => {}, opts: GenerateOptions = {}): Promise<GenerateResult> {
  const checkpoint = loadCheckpoint(dir);
  return generateDesign(checkpoint.input, onEvent, { ...opts, checkpoint });
}

export async function generateDesign(input: GenerateInput, onEvent: (e: GenerateEvent) => void = () => {}, opts: DesignOptions = {}): Promise<GenerateResult> {
  if (!input.text?.trim() && !input.image) throw new Error("Provide a description or a photo.");
  const anthropic = opts.client ?? getClient();
  const cp = opts.checkpoint;
  const debug = cp ? DebugRun.open(cp.dir) : new DebugRun(`subbuilds-${input.text?.trim() || "photo"}`);
  onEvent({ type: "start", debugDir: debug.dir });
  const system = systemPrompt();
  const fmt = codec();
  if (!cp) {
    debug.write("input.json", { mode: "build", pipeline: "subbuilds", text: input.text ?? null, detail: input.detail ?? null, hasImage: !!input.image, config: CONFIG });
    debug.write("system-prompt.md", system);
    if (input.image) debug.writeBinary(`input-image.${input.image.mediaType.split("/")[1]}`, Buffer.from(input.image.data, "base64"));
  }
  // Rounds from the interrupted run whose stage is redone now still count toward the total cost.
  const earlierRounds: RoundSummary[] = [];
  const ctx = { anthropic, debug, onEvent, signal: opts.signal };
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
    } else photo = await analyzePhoto({ text: input.text, image: input.image, detail: input.detail }, CONFIG.design.grid, ctx, system);
    onEvent({ type: "analysis", analysis: photo.analysis, target: photo.target, cost: photo.usage.cost });
    onEvent({ type: "stage", scope: "analysis", label: "Reading the photo", status: "done", valid: true, cost: photo.usage.cost });
  }

  // --- 1. plan --------------------------------------------------------------------------
  onEvent({ type: "stage", scope: "plan", label: "Planning sub-builds", status: "start" });
  const planText = planPrompt(input.text ?? "", input.detail, !!input.image, photo ? analysisBlock(photo.analysis, photo.target) : undefined);
  if (cp && !cp.plan.valid) earlierRounds.push(...cp.plan.rounds);
  const planLoop = cp?.plan.valid ? reusedLoop(cp.plan, cp.plan.valid, 0) : await runLoop<Plan>(
    {
      scope: "plan",
      stage: "plan",
      debugPrefix: "plan.",
      system,
      firstContent: withImage(planText),
      firstText: planText,
      schema: planJsonSchema(),
      parse: (t) => parseJson(t, PlanSchema),
      check: (plan) => {
        const errors = checkPlan(plan);
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

  // --- 2. unique sub-builds, in parallel ------------------------------------------------
  const subLoops = await pool(plan.subBuilds, CONFIG.subbuilds.concurrency, async (sub) => {
    const scope = `sub:${sub.id}`;
    onEvent({ type: "stage", scope, label: sub.name, status: "start", copies: sub.copies });
    const text = subBuildPrompt(plan, sub);
    const saved = cp?.subs.get(sub.id);
    if (saved?.valid) {
      const loop = reusedLoop(saved, saved.valid, saved.valid.parts.length);
      onEvent({ type: "stage", scope, label: sub.name, status: "done", valid: true, parts: saved.valid.parts.length, copies: sub.copies, cost: loop.usage.cost });
      return { sub, loop };
    }
    if (saved) earlierRounds.push(...saved.rounds);
    const loop = await runLoop<BrickModel>(
      {
        scope,
        stage: "subBuild",
        debugPrefix: `sub-${sub.id}.`,
        system,
        firstContent: text,
        firstText: text,
        schema: brickModelJsonSchema(),
        tools: [searchPartsTool],
        parse: (t) => parseJson(t, BrickModelSchema),
        diff: { schema: modelDiffJsonSchema(fmt), apply: (prev, json) => applyModelDiff(prev, json, fmt), listing: (m) => modelListing(m, fmt), instructions: DIFF_INSTRUCTIONS },
        check: (model, last) => {
          const v = validate(model, { grid: { x: sub.w, z: sub.d, y: sub.h }, maxParts: Math.min(CONFIG.maxParts, Math.ceil(sub.parts * 1.6) + 10), structure: last ? "warn" : "error" });
          return { errors: v.errors, warnings: v.warnings, valid: v.valid, partCount: model.parts.length };
        },
      },
      ctx,
    );
    onEvent({ type: "stage", scope, label: sub.name, status: "done", valid: loop.best?.check.valid ?? false, parts: loop.best?.value.parts.length ?? 0, copies: sub.copies, cost: loop.usage.cost });
    return { sub, loop };
  });
  const built = subLoops.filter((s) => s.loop.best).map(({ sub, loop }) => ({ sub, model: loop.best!.value, valid: loop.best!.check.valid }));
  if (!built.length) throw new Error("None of the sub-builds could be designed; see the debug folder.");
  const subBuilds: BrickDesign["subBuilds"] = built.map(({ sub, model }) => ({ id: sub.id, name: sub.name, parts: model.parts, uses: [] }));
  debug.write("subbuilds.json", subBuilds);

  // --- 3. assembly ------------------------------------------------------------------------
  onEvent({ type: "stage", scope: "assembly", label: "Assembling", status: "start" });
  const request = input.text ?? "";
  const aText = assemblyPrompt(
    request,
    plan,
    built.map(({ sub, model }) => ({ id: sub.id, name: sub.name, copies: sub.copies, parts: model.parts.length, maps: surfaceMaps(model) })),
  );
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
      schema: assemblyJsonSchema(PART_IDS, COLOR_IDS, subBuilds.map((s) => s.id)),
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
  const rounds = [...(photo?.rounds ?? []), ...earlierRounds, ...planLoop.rounds, ...subLoops.flatMap((s) => s.loop.rounds), ...assembly.rounds];
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
  };
  const stages = {
    ...(photo ? { analysis: { subject: photo.analysis.subject, target: photo.target, rounds: photo.rounds.length, cost: photo.usage.cost } } : {}),
    plan: { rounds: planLoop.rounds.length, cost: planLoop.usage.cost },
    subBuilds: subLoops.map(({ sub, loop }) => ({ id: sub.id, name: sub.name, copies: sub.copies, parts: loop.best?.value.parts.length ?? 0, valid: loop.best?.check.valid ?? false, rounds: loop.rounds.length, cost: loop.usage.cost })),
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
  debug.write("summary.json", { pipeline: "subbuilds", valid: result.valid, stages, rounds, total: usage, ...(resumed ? { resumed } : {}), partCount: result.model?.parts.length ?? 0, compile: compiled?.stats, catalog });
  if (design) debug.write("final-design.json", design);
  if (result.model) debug.write("final-model.json", result.model);
  if (resumed) console.log(`[generate] resumed: reused plan=${resumed.reused.plan}, sub-builds [${resumed.reused.subBuilds.join(", ")}], assembly=${resumed.reused.assembly}; earlier $${resumed.costBefore.toFixed(4)}, now $${resumed.costNow.toFixed(4)}`);
  console.log(`[generate] sub-builds done: valid=${result.valid}, ${result.model?.parts.length ?? 0} parts, ${compiled?.stats.copies ?? 0} copies, ${rounds.length} round(s) · total ${formatUsage(usage)} · debug: ${debug.dir}`);
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
    { anthropic, debug, onEvent, signal: opts.signal },
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
