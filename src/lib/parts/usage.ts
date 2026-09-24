import type { BrickModel } from "../model/schema";
import { CORE_MENU_CATALOG } from "./core";
import { getPart } from "./library";

export interface CatalogUsage {
  /** Placements of catalog parts, by id. */
  parts: Record<string, number>;
  /** Of those: listed in the core menu vs found only through search_parts. */
  fromMenu: number;
  fromSearch: number;
  /** Placements of hand-made core parts. */
  core: number;
}

const MENU = new Set(CORE_MENU_CATALOG);

/** Which catalog parts a model uses (logged in each run's summary.json; see npm run catalog-usage). */
export function catalogUsage(model: BrickModel | null | undefined): CatalogUsage {
  const out: CatalogUsage = { parts: {}, fromMenu: 0, fromSearch: 0, core: 0 };
  for (const p of model?.parts ?? []) {
    const def = getPart(p.part);
    if (!def) continue;
    if (def.source !== "catalog") {
      out.core++;
      continue;
    }
    out.parts[p.part] = (out.parts[p.part] ?? 0) + 1;
    if (MENU.has(p.part)) out.fromMenu++;
    else out.fromSearch++;
  }
  return out;
}

export function formatCatalogUsage(u: CatalogUsage): string {
  const ids = Object.entries(u.parts).sort((a, b) => b[1] - a[1]);
  if (!ids.length) return "catalog parts: none";
  return `catalog parts: ${u.fromMenu + u.fromSearch} placements of ${ids.length} kinds (${u.fromSearch} found by search): ${ids.slice(0, 12).map(([id, n]) => `${id}×${n}`).join(" ")}`;
}
