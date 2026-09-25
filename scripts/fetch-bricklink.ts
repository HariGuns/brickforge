/**
 * BrickLink IDs for every part and colour, from Rebrickable's LDraw → BrickLink data.
 *   npm run fetch-bricklink            (needs REBRICKABLE_API_KEY in .env.local)
 * Writes src/lib/bricklink/rebrickable.json: LDraw file → BrickLink part number,
 * our colour → BrickLink colour number, and the parts with no match (flagged).
 * Responses are cached in node_modules/.cache/rebrickable, so reruns are free.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
config({ path: ".env.local" });

const { CORE_PARTS, CATALOG_PARTS, SNOT_PARTS } = await import("../src/lib/parts/library");
const { BRICKLINK_PARTS } = await import("../src/lib/bricklink/ids");
const { COLORS } = await import("../src/lib/parts/colors");

const KEY = process.env.REBRICKABLE_API_KEY;
if (!KEY) {
  console.error("Set REBRICKABLE_API_KEY in .env.local (a free key from rebrickable.com → Settings → API).");
  process.exit(2);
}
const API = "https://rebrickable.com/api/v3/lego";
const CACHE = "node_modules/.cache/rebrickable";
fs.mkdirSync(CACHE, { recursive: true });
const OUT = "src/lib/bricklink/rebrickable.json";

let last = 0;
/** GET with a file cache and Rebrickable's rate limit (about one request a second). The key is never logged. */
async function get<T>(url: string): Promise<T> {
  const file = path.join(CACHE, url.replace(/^https:\/\/[^/]+/, "").replace(/[^a-z0-9._-]+/gi, "_").slice(0, 200) + ".json");
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  for (let attempt = 0; ; attempt++) {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const res = await fetch(url, { headers: { Authorization: `key ${KEY}`, Accept: "application/json" } });
    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Rebrickable ${res.status} for ${url.replace(API, "")}`);
    const json = (await res.json()) as T;
    fs.writeFileSync(file, JSON.stringify(json));
    return json;
  }
}

interface RbPart {
  part_num: string;
  name: string;
  external_ids: Record<string, string[]>;
}
interface RbColor {
  id: number;
  name: string;
  external_ids: Record<string, { ext_ids: number[] }>;
}
interface Page<T> {
  next: string | null;
  results: T[];
}

// --- colours ------------------------------------------------------------------------------
const colors: RbColor[] = [];
for (let url: string | null = `${API}/colors/?page_size=1000`; url; ) {
  const page: Page<RbColor> = await get(url);
  colors.push(...page.results);
  url = page.next;
}
const blColor: Record<string, number> = {};
const colorMisses: string[] = [];
for (const c of COLORS) {
  const rb = colors.find((x) => x.external_ids.LDraw?.ext_ids.includes(c.ldraw));
  const bl = rb?.external_ids.BrickLink?.ext_ids[0];
  if (bl === undefined) colorMisses.push(`${c.id} (LDraw ${c.ldraw})`);
  else blColor[c.id] = bl;
}

// --- parts --------------------------------------------------------------------------------
// Every LDraw file a placement can turn into: core and catalog parts (upright and sideways),
// wheel rims and tyres, and the pieces the hand-made core table lists.
const stem = (f: string) => f.replace(/\.dat$/i, "").toLowerCase();
const users = new Map<string, Set<string>>();
const need = (ldraw: string, who: string) => (users.get(ldraw) ?? users.set(ldraw, new Set()).get(ldraw)!).add(who);
for (const p of [...CORE_PARTS, ...CATALOG_PARTS, ...SNOT_PARTS]) {
  if (p.bricklink) for (const b of p.bricklink) need(b.id.toLowerCase(), p.id);
  else need(stem(p.ldraw.file), p.id);
}
const wanted = [...users.keys()].sort();

/** LDraw's "0 ~Moved to 3040b" aliases: the part's current number. */
function movedTo(ldraw: string): string | null {
  const f = path.join("ldraw-lib/ldraw/parts", `${ldraw}.dat`);
  if (!fs.existsSync(f)) return null;
  const m = fs.readFileSync(f, "utf8").split("\n", 1)[0].match(/^0\s+~Moved to\s+(\S+)/i);
  return m ? stem(m[1]) : null;
}

/** The BrickLink number for a Rebrickable part: its own number if BrickLink lists it, else BrickLink's first. */
const pick = (p: RbPart, ldraw: string) => {
  const bl = p.external_ids.BrickLink ?? [];
  return bl.find((b) => b.toLowerCase() === ldraw) ?? bl[0];
};
const blPart: Record<string, string> = {};
// 1. By part number (Rebrickable numbers mostly equal LDraw's), 100 at a time.
for (let i = 0; i < wanted.length; i += 100) {
  const batch = wanted.slice(i, i + 100);
  const page: Page<RbPart> = await get(`${API}/parts/?part_nums=${batch.map(encodeURIComponent).join(",")}&inc_part_details=1&page_size=1000`);
  for (const p of page.results) {
    const ldraw = p.part_num.toLowerCase();
    // Only when Rebrickable also says it's this LDraw part (or lists no LDraw number).
    const ld = (p.external_ids.LDraw ?? []).map((s) => s.toLowerCase());
    const bl = pick(p, ldraw);
    if (bl && (!ld.length || ld.includes(ldraw))) blPart[ldraw] = bl;
  }
  process.stdout.write(`\rparts by number: ${Math.min(i + 100, wanted.length)}/${wanted.length}`);
}
console.log();
// 2. The rest by LDraw number (Rebrickable numbers some parts differently), following LDraw's
//    "moved to" aliases (3040 is now 3040b).
const rest = wanted.filter((w) => !blPart[w]);
const known = new Set<string>(); // on Rebrickable, but without a BrickLink number
for (const [k, ldraw] of rest.entries()) {
  for (const id of [ldraw, movedTo(ldraw)].filter((x): x is string => !!x)) {
    const page: Page<RbPart> = await get(`${API}/parts/?ldraw_id=${encodeURIComponent(id)}&inc_part_details=1`);
    if (page.results.length) known.add(ldraw);
    const bl = page.results.map((p) => pick(p, id)).find(Boolean);
    if (bl) {
      blPart[ldraw] = bl;
      break;
    }
  }
  process.stdout.write(`\rparts by LDraw number: ${k + 1}/${rest.length}`);
}
if (rest.length) console.log();

// 3. The hand-made core table lists BrickLink numbers directly: check each exists on BrickLink.
const tableIds = [...new Set(Object.values(BRICKLINK_PARTS).flatMap((items) => items.map((b) => b.id)))].sort();
const tableMissing: string[] = [];
/** Table numbers BrickLink now lists under another (primary) number; the upload wants the primary. */
const tableRenamed: Record<string, string> = {};
for (const id of tableIds) {
  const page: Page<RbPart> = await get(`${API}/parts/?bricklink_id=${encodeURIComponent(id)}&inc_part_details=1`);
  // (The filter also matches Rebrickable's own part number, so check BrickLink's list itself.)
  const lists = page.results.map((p) => p.external_ids.BrickLink ?? []);
  if (lists.some((bl) => bl.includes(id))) continue;
  const primary = lists.find((bl) => bl.length)?.[0];
  if (primary) tableRenamed[id] = primary;
  else tableMissing.push(id);
}

const unmatched = wanted
  .filter((w) => !blPart[w])
  .map((ldraw) => ({ ldraw, usedBy: [...users.get(ldraw)!].sort(), reason: known.has(ldraw) ? "Rebrickable lists no BrickLink number" : "not found on Rebrickable" }));
const renamed = Object.entries(blPart).filter(([ld, bl]) => ld !== bl.toLowerCase());
fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      generated: new Date().toISOString().slice(0, 10),
      source: "Rebrickable API v3 (LDraw → BrickLink external IDs)",
      colors: blColor,
      parts: Object.fromEntries(Object.entries(blPart).sort()),
      unmatched,
      coreTableMissing: tableMissing,
      coreTableRenamed: tableRenamed,
    },
    null,
    1,
  ) + "\n",
);
console.log(`${Object.keys(blPart).length} of ${wanted.length} LDraw parts matched (${renamed.length} have a different BrickLink number); ${COLORS.length - colorMisses.length} of ${COLORS.length} colours.`);
for (const u of unmatched) console.log(`  no match: ${u.ldraw} (used by ${u.usedBy.join(", ")}): ${u.reason}`);
console.log(`Core table: ${tableIds.length - tableMissing.length - Object.keys(tableRenamed).length} of ${tableIds.length} BrickLink numbers confirmed.${tableMissing.length ? ` Not found: ${tableMissing.join(", ")}` : ""}`);
for (const [from, to] of Object.entries(tableRenamed)) console.log(`  core table: ${from} is now listed as ${to}`);
for (const c of colorMisses) console.log(`  no colour match: ${c}`);
console.log(`wrote ${OUT}`);
