import { CORE_MENU_CATALOG } from "./core";
import { partRow, PART_TABLE_HEADER } from "./describe";
import { CORE_PARTS, getPart, PARTS, type PartDef } from "./library";

/** The parts always listed in Claude's prompt. */
export function coreMenu(): PartDef[] {
  return [...CORE_PARTS, ...CORE_MENU_CATALOG.map((id) => getPart(id)).filter((p): p is PartDef => !!p)];
}

const norm = (s: string) => s.toLowerCase().replace(/×/g, "x");
/** "2x4", "1 x 2 x 3" → normalised size tokens. */
const sizes = (s: string) => [...norm(s).matchAll(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*x\s*(\d+(?:\.\d+)?))?/g)].map((m) => [m[1], m[2], m[3]].filter(Boolean).join("x"));

interface Indexed {
  def: PartDef;
  words: Set<string>;
  text: string;
  sizes: string[];
}
let index: Indexed[] | null = null;
function getIndex(): Indexed[] {
  return (index ??= PARTS.map((def) => {
    const text = norm(`${def.id} ${def.name} ${def.category} ${def.hint ?? ""}`);
    const own = sizes(def.name);
    const dims = [`${Math.min(def.w, def.d)}x${Math.max(def.w, def.d)}`, `${def.w}x${def.d}`, `${def.d}x${def.w}`];
    return { def, words: new Set(text.split(/[^a-z0-9.]+/).filter(Boolean)), text, sizes: [...own, ...dims] };
  }));
}

/** Synonyms Claude tends to use. */
const SYNONYMS: Record<string, string[]> = {
  wheel: ["wheel", "tyre", "tire", "rim"],
  tire: ["tyre"],
  tyres: ["tyre"],
  windshield: ["windscreen"],
  windscreen: ["windscreen", "cockpit"],
  mudguard: ["mudguard", "fender"],
  fender: ["mudguard"],
  axle: ["pin", "pins", "holder"],
  holder: ["pin", "pins", "holder"],
  curved: ["curved", "curve"],
  wedge: ["wedge", "wing"],
  grille: ["grille", "grill"],
};

/**
 * Keyword search over every part (core and catalog): words in the name,
 * category and notes, and sizes like "2x4". Returns the best matches first.
 */
export function searchParts(query: string, opts: { category?: string; limit?: number } = {}): PartDef[] {
  const q = norm(query);
  const qSizes = sizes(q);
  const words = q.replace(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(\s*x\s*(\d+(?:\.\d+)?))?/g, " ").split(/[^a-z0-9.]+/).filter((w) => w.length > 1);
  const scored: { def: PartDef; score: number }[] = [];
  for (const it of getIndex()) {
    if (opts.category && it.def.category !== opts.category) continue;
    let score = 0;
    for (const w of words) {
      const alts = [w, w.replace(/s$/, ""), ...(SYNONYMS[w] ?? [])];
      if (alts.some((a) => it.words.has(a))) score += 3;
      else if (alts.some((a) => a.length > 3 && it.text.includes(a))) score += 1;
      else score -= 1;
    }
    for (const s of qSizes) if (it.sizes.includes(s)) score += 4;
    if (score <= 0) continue;
    // Prefer core parts and simpler names on ties.
    score += it.def.source === "core" ? 0.5 : 0;
    score -= it.def.name.length / 200;
    scored.push({ def: it.def, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 12).map((s) => s.def);
}

/** Tool result text: a part table (same columns as the prompt's). */
export function searchResultText(query: string, category?: string): string {
  const found = searchParts(query, { category, limit: 12 });
  if (!found.length) return `No parts match "${query}". Try fewer or different words (e.g. "wedge plate", "curved slope 2x4", "wheel").`;
  return [`${found.length} part(s) for "${query}"${category ? ` in ${category}` : ""}:`, PART_TABLE_HEADER, ...found.map(partRow)].join("\n");
}

export const SEARCH_CATEGORIES = [...new Set(PARTS.map((p) => p.category))].sort();
