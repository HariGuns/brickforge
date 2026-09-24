/**
 * Where the tokens go: every round of every run in debug/, grouped by stage,
 * with input / cache / output tokens and cost, the cache hit rate, and an
 * estimate of how much output is the JSON answer vs thinking (answer tokens
 * are estimated from the saved answer text at ~3.1 characters per token,
 * which is typical for this JSON; thinking is the rest of the output).
 *
 * Usage: npm run token-report [-- --since 2026-09-24] [-- --md out.md]
 */
import fs from "node:fs";
import path from "node:path";
import { CONFIG, pricingFor } from "../src/lib/config";

const args = process.argv.slice(2);
const since = args.includes("--since") ? args[args.indexOf("--since") + 1] : "";
const mdOut = args.includes("--md") ? args[args.indexOf("--md") + 1] : "";
const CHARS_PER_TOKEN = 3.1;

interface Row {
  rounds: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  answer: number;
  parts: number;
  cost: number;
}
const stages = new Map<string, Row>();
const settings = new Map<string, { rounds: number; output: number; cost: number }>();
const add = (k: string, r: Partial<Row>) => {
  const s = stages.get(k) ?? { rounds: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, answer: 0, parts: 0, cost: 0 };
  for (const key of Object.keys(r) as (keyof Row)[]) s[key] += r[key] ?? 0;
  stages.set(k, s);
};

const root = path.resolve(CONFIG.debugDir);
let runs = 0;
for (const dir of fs.readdirSync(root).sort()) {
  if (since && dir < since) continue;
  const full = path.join(root, dir);
  if (!fs.statSync(full).isDirectory()) continue;
  const edit = dir.includes("-edit-");
  const files = fs.readdirSync(full).filter((f) => f.endsWith(".validation.json"));
  if (!files.length) continue;
  runs++;
  for (const f of files) {
    let v: { summary?: { scope?: string; round?: number; partCount?: number; model?: string; effort?: string; usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number } } };
    try {
      v = JSON.parse(fs.readFileSync(path.join(full, f), "utf8"));
    } catch {
      continue;
    }
    const s = v.summary;
    if (!s?.usage) continue;
    const scope = s.scope ?? "main";
    const repair = (s.round ?? 0) > 0;
    const base = scope === "main" ? (edit ? "edit" : "design (single pass)") : scope.startsWith("sub:") ? "sub-build" : scope.startsWith("refine") ? "comparison" : scope;
    const stage = `${base}${repair ? " · repair" : ""}`;
    const raw = path.join(full, f.replace(".validation.json", ".raw.json.txt"));
    const answer = fs.existsSync(raw) ? Math.round(fs.statSync(raw).size / CHARS_PER_TOKEN) : 0;
    add(stage, { rounds: 1, ...s.usage, answer: Math.min(answer, s.usage.output), parts: s.partCount ?? 0 });
    const key = `${s.model ?? "(not logged: default model)"} · ${s.effort ?? "high"}`;
    const e = settings.get(key) ?? { rounds: 0, output: 0, cost: 0 };
    settings.set(key, { rounds: e.rounds + 1, output: e.output + s.usage.output, cost: e.cost + s.usage.cost });
  }
}

const rows = [...stages].sort((a, b) => b[1].cost - a[1].cost);
const total = rows.reduce((t, [, r]) => t + r.cost, 0);
const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const lines = [
  `Token use by stage — ${runs} runs in ${CONFIG.debugDir}/${since ? ` since ${since}` : ""}, total $${total.toFixed(2)}`,
  "",
  "| stage | rounds | cost | share | input (uncached) | cache write | cache read | cache hit | output | of which answer (est.) | answer tokens / part |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map(([name, r]) => {
    const inTotal = r.input + r.cacheRead + r.cacheWrite;
    return `| ${name} | ${r.rounds} | $${r.cost.toFixed(2)} | ${((r.cost / total) * 100).toFixed(0)}% | ${k(r.input)} | ${k(r.cacheWrite)} | ${k(r.cacheRead)} | ${inTotal ? ((r.cacheRead / inTotal) * 100).toFixed(0) : 0}% | ${k(r.output)} | ${k(r.answer)} (${r.output ? ((r.answer / r.output) * 100).toFixed(0) : 0}%) | ${r.parts ? (r.answer / r.parts).toFixed(1) : "–"} |`;
  }),
];
// Where the money goes, by token kind.
const p = pricingFor(CONFIG.model);
const sum = (f: (r: Row) => number) => rows.reduce((t, [, r]) => t + f(r), 0);
const byKind = {
  "output: answer (JSON)": (sum((r) => r.answer) * p.output) / 1e6,
  "output: thinking": (sum((r) => r.output - r.answer) * p.output) / 1e6,
  "input: cache writes": (sum((r) => r.cacheWrite) * p.cacheWrite) / 1e6,
  "input: cache reads": (sum((r) => r.cacheRead) * p.cacheRead) / 1e6,
  "input: uncached": (sum((r) => r.input) * p.input) / 1e6,
};
lines.push("", "| cost by token kind | $ | share |", "|---|---|---|", ...Object.entries(byKind).map(([n, c]) => `| ${n} | $${c.toFixed(2)} | ${((c / total) * 100).toFixed(0)}% |`));
lines.push("", "| model · effort | rounds | output tokens | output / round | cost |", "|---|---|---|---|---|", ...[...settings].map(([n, e]) => `| ${n} | ${e.rounds} | ${k(e.output)} | ${k(Math.round(e.output / e.rounds))} | $${e.cost.toFixed(2)} |`));
console.log(lines.join("\n"));
if (mdOut) fs.writeFileSync(mdOut, lines.join("\n") + "\n");
