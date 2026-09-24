import { rotatePoint, worldPins, type WorldPin } from "../model/geometry";
import type { Placement, Rot } from "../model/schema";
import { getPart, oppositeDir, rotateDir, type PartDef } from "./library";

const ROTS: Rot[] = [0, 90, 180, 270];
const isInt = (n: number) => Math.abs(n - Math.round(n)) < 1e-6;

/**
 * Where a wheel must go to sit on a pin: the rotation that turns its hub to
 * face the pin, and the placement that puts the hub exactly on the pin's
 * point. Null if the kinds differ or the point isn't reachable on the grid.
 */
export function wheelMount(pin: WorldPin, wheel: PartDef): { x: number; y: number; z: number; rot: Rot } | null {
  const hub = wheel.hub;
  if (!hub || hub.kind !== pin.kind) return null;
  const rot = ROTS.find((r) => rotateDir(hub.dir, r) === oppositeDir(pin.dir));
  if (rot === undefined) return null;
  const [ox, oz] = rotatePoint(hub.at[0], hub.at[2], wheel, rot);
  const x = pin.at[0] - ox, y = pin.at[1] - hub.at[1], z = pin.at[2] - oz;
  if (!isInt(x) || !isInt(y) || !isInt(z)) return null;
  return { x: Math.round(x), y: Math.round(y), z: Math.round(z), rot };
}

/** Wheel placements for every pin of a holder at `holder` (e.g. for prompts and hints). */
export function mountsFor(holder: Placement, wheelId: string): { pin: WorldPin; at: { x: number; y: number; z: number; rot: Rot } }[] {
  const hdef = getPart(holder.part), wheel = getPart(wheelId);
  if (!hdef || !wheel) return [];
  return worldPins(holder, hdef).flatMap((pin) => {
    const at = wheelMount(pin, wheel);
    return at ? [{ pin, at }] : [];
  });
}
