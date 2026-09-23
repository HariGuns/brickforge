import { COLOR_MAP } from "@/lib/parts/colors";
import { getPart, PARTS } from "@/lib/parts/library";
import type { BrickModel } from "@/lib/model/schema";

const ORDER = new Map(PARTS.map((p, i) => [p.id, i]));

/** Aggregated part × colour counts, for the whole model or a subset of part indices. */
export function PartsList({ model, indices, compact }: { model: BrickModel; indices?: number[]; compact?: boolean }) {
  const counts = new Map<string, { part: string; color: string; n: number }>();
  for (const i of indices ?? model.parts.map((_, i) => i)) {
    const p = model.parts[i];
    const k = `${p.part}|${p.color}`;
    const e = counts.get(k) ?? { part: p.part, color: p.color, n: 0 };
    e.n++;
    counts.set(k, e);
  }
  const rows = [...counts.values()].sort((a, b) => (ORDER.get(a.part) ?? 999) - (ORDER.get(b.part) ?? 999) || a.color.localeCompare(b.color));
  return (
    <ul className={`parts ${compact ? "compact" : ""}`}>
      {rows.map((r) => {
        const def = getPart(r.part);
        const c = COLOR_MAP.get(r.color);
        return (
          <li key={`${r.part}|${r.color}`} title={`${def?.name ?? r.part} · ${c?.name ?? r.color} · LDraw ${def?.ldraw.file ?? "?"}`}>
            <span className="qty">{r.n}×</span>
            <span className="swatch" style={{ background: c?.hex ?? "#f0f" }} />
            <span className="pname">{def?.name ?? r.part}</span>
            {!compact && <span className="muted">{c?.name ?? r.color}</span>}
          </li>
        );
      })}
    </ul>
  );
}
