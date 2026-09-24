import { CONFIG } from "../config";
import type { BrickModel } from "../model/schema";
import { compactCodec, jsonCodec, type Codec } from "./codec";

/** The output/listing format in use (CONFIG.outputFormat). */
export function codec(): Codec {
  return CONFIG.outputFormat === "json" ? jsonCodec : compactCodec;
}

/** How parts (and copies) are written, for prompts. */
export function formatHelp(c: Codec = codec(), copies = false): string {
  if (c.name === "json") return `Each part is an object {"part", "color", "x", "y", "z", "rot"}${copies ? ` and each copy {"sub", "x", "y", "z", "rot", "mirror"}` : ""}.`;
  return `Each part is one string: "<part id> <color> <x> <y> <z> <rot>", e.g. "brick_2x4 red 3 0 5 90".${copies ? ` Each copy is one string: "<sub-build id> <x> <y> <z> <rot>", plus " m" at the end for a mirror image, e.g. "pine_tree 4 1 0 270" or "side_panel 0 1 0 0 m".` : ""}`;
}

/** One placement per line, numbered, so Claude can refer to parts by index and copy them exactly. */
export function modelListing(model: BrickModel, c: Codec = codec()): string {
  return model.parts.map((p, i) => `#${i} ${c.formatPlacement(p)}`).join("\n");
}
