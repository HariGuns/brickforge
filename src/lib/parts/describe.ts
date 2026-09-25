import type { ConnectorCell } from "./catalogTypes";
import type { PartDef } from "./library";

/** "all", "none", or "(x,z) (x,z)@2" — cells, with a level when it's not the default. */
function cells(list: ConnectorCell[] | undefined, dflt: (level: number) => boolean, what: "top" | "bottom"): string {
  if (!list) return "all";
  if (!list.length) return "none";
  return list.map(([x, z, l]) => `(${x},${z})${l === undefined || dflt(l) ? "" : `@${l}`}`).join(" ");
}

const dirWord: Record<string, string> = { "+x": "+x side", "-x": "-x side", "+z": "+z side", "-z": "-z side" };

/** Connection notes for pins and hubs. */
export function pinText(def: PartDef): string {
  const out: string[] = [];
  if (def.pins?.length) {
    const kind = def.pins[0].kind === "wpin" ? "wheel pins" : "Technic pins";
    out.push(`${kind} on ${def.pins.map((p) => dirWord[p.dir]).join(", ")} (take wheels with a matching hub)`);
  }
  if (def.sideStuds?.length)
    out.push(`side studs (for sideways copies): ${def.sideStuds.map((s, i) => `${i}: ${s.dir} face at (${s.at[0]},${s.at[1]}@,${s.at[2]})`.replace("@,", " plates up,")).join("; ")}${def.fine ? "; has a flange outside its footprint" : ""}`);
  if (def.hub) out.push(`wheel: mounts only on a ${def.hub.kind === "wpin" ? "wheel pin" : "Technic pin"}; hub faces ${def.hub.dir} at rot 0`);
  return out.join("; ");
}

/** One row of the part table (same columns in the prompt and in search results). */
export function partRow(p: PartDef): string {
  const notes = [pinText(p), p.hint].filter(Boolean).join("; ");
  return `| ${p.id} | ${p.name} | ${p.w}×${p.d} | ${p.h} | ${cells(p.studs, (l) => l === p.h, "top")} | ${cells(p.bottom, (l) => l === 0, "bottom")} | ${notes} |`;
}

export const PART_TABLE_HEADER = [
  "| id | name | footprint at rot 0 (x×z studs) | height (plates) | studs (local x,z; @n = n plates above the part's bottom, else on top) | underside takes studs at (@n = n plates up) | notes |",
  "|---|---|---|---|---|---|---|",
].join("\n");
