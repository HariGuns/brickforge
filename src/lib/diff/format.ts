import type { BrickModel } from "../model/schema";
import { jsonCodec, type Codec } from "./codec";

/** The output/listing format in use. */
export function codec(): Codec {
  return jsonCodec;
}

/** One placement per line, numbered, so Claude can refer to parts by index and copy them exactly. */
export function modelListing(model: BrickModel, c: Codec = codec()): string {
  return model.parts.map((p, i) => `#${i} ${c.formatPlacement(p)}`).join("\n");
}
