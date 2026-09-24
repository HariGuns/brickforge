import type { BrickModel } from "../model/schema";
import { BRICKLINK_COLORS, bricklinkFor } from "./ids";

export interface WantedItem {
  id: string;
  color: number;
  qty: number;
}

/** BrickLink items for a model, merged by part and colour, largest quantities first. */
export function wantedItems(model: BrickModel): WantedItem[] {
  const items = new Map<string, WantedItem>();
  for (const p of model.parts) {
    const pieces = bricklinkFor(p.part);
    if (!pieces) throw new Error(`No BrickLink ID for part ${p.part}`);
    const color = BRICKLINK_COLORS[p.color];
    if (color === undefined) throw new Error(`No BrickLink colour for ${p.color}`);
    for (const piece of pieces) {
      const c = piece.color ?? color;
      const key = `${piece.id}|${c}`;
      const e = items.get(key) ?? items.set(key, { id: piece.id, color: c, qty: 0 }).get(key)!;
      e.qty++;
    }
  }
  return [...items.values()].sort((a, b) => b.qty - a.qty || a.id.localeCompare(b.id, "en", { numeric: true }) || a.color - b.color);
}

/** A BrickLink wanted list (XML upload format): Wanted › Upload › paste or upload this file. */
export function exportWantedList(model: BrickModel): string {
  const rows = wantedItems(model).map(
    (i) => `  <ITEM>\n    <ITEMTYPE>P</ITEMTYPE>\n    <ITEMID>${i.id}</ITEMID>\n    <COLOR>${i.color}</COLOR>\n    <MINQTY>${i.qty}</MINQTY>\n  </ITEM>`,
  );
  return `<INVENTORY>\n${rows.join("\n")}\n</INVENTORY>\n`;
}
