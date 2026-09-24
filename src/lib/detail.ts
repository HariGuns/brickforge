import { CONFIG } from "./config";

/** How big and detailed a new build is: sets the target width (studs) and the part budget. */
export type Detail = "standard" | "high" | "very_high";
export const DETAILS: { id: Detail; label: string }[] = [
  { id: "standard", label: "Standard" },
  { id: "high", label: "High" },
  { id: "very_high", label: "Very high" },
];

/** A Detail from a request, also accepting the old Small / Medium / Large sizes. */
export function toDetail(v: unknown): Detail | undefined {
  if (v === "standard" || v === "high" || v === "very_high") return v;
  if (v === "small" || v === "medium") return "standard";
  if (v === "large") return "high";
  return undefined;
}

export const detailLabel = (d: Detail | undefined) => DETAILS.find((x) => x.id === (d ?? "standard"))!.label;

/** Target width (studs) and part budget for a detail level; vehicles are at least CONFIG.detail.vehicleMinWidth wide. */
export function detailTarget(detail: Detail | undefined, opts: { vehicle?: boolean } = {}): { width: number; parts: number } {
  const t = CONFIG.detail[detail ?? "standard"];
  return { width: opts.vehicle ? Math.max(t.width, CONFIG.detail.vehicleMinWidth) : t.width, parts: t.parts };
}
