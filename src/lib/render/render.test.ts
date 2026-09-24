import { describe, expect, it } from "vitest";
import zlib from "node:zlib";
import { renderModel } from "./render";
import { P } from "../fixtures/samples";

/** Decode our own PNGs (RGB, filter 0) back to pixels. */
function decode(png: Buffer): { w: number; h: number; px: (x: number, y: number) => [number, number, number] } {
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  let o = 8;
  const idat: Buffer[] = [];
  while (o < png.length) {
    const len = png.readUInt32BE(o), type = png.subarray(o + 4, o + 8).toString();
    if (type === "IDAT") idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  return { w, h, px: (x, y) => [0, 1, 2].map((c) => raw[y * (w * 3 + 1) + 1 + x * 3 + c]) as [number, number, number] };
}

// A red brick on the right (max x) and a blue one on the left.
const model = { name: "t", description: "", parts: [P("plate_4x4", "white", 0, 0, 0), P("brick_2x2", "blue", 0, 1, 1), P("brick_2x2", "red", 2, 1, 1)] };

describe("software renderer", () => {
  it("draws the model at the requested size, on the background", async () => {
    const img = decode(await renderModel(model, { azimuth: 30, elevation: 20 }, { width: 160, height: 100 }));
    expect([img.w, img.h]).toEqual([160, 100]);
    expect(img.px(2, 2)).toEqual([236, 238, 234]);
    expect(img.px(80, 50)).not.toEqual([236, 238, 234]);
  });

  it("azimuth 90 looks at the right side (max x), -90 at the left", async () => {
    const centre = async (az: number) => decode(await renderModel(model, { azimuth: az, elevation: 5 }, { width: 120, height: 80 })).px(60, 36);
    const [r1, , b1] = await centre(90);
    const [r2, , b2] = await centre(-90);
    expect(r1).toBeGreaterThan(b1); // red faces the camera
    expect(b2).toBeGreaterThan(r2); // blue faces the camera
  });

  it("renders catalog parts from their meshes, with black tyres", async () => {
    const car = { name: "t", description: "", parts: [P("4624c01", "white", 0, 0, 0)] };
    const img = decode(await renderModel(car, { azimuth: 90, elevation: 0 }, { width: 100, height: 100 }));
    // The tyre ring is dark, the rim inside it light.
    const dark = [...Array(100).keys()].some((x) => img.px(x, 50).every((c) => c < 70));
    expect(dark).toBe(true);
  });
});
