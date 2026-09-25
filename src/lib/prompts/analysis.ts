/**
 * Photo analysis: before designing, Claude describes the subject (what it is,
 * real proportions, key features, colours, and the camera angle), and the code
 * turns that into a target size. Tune freely.
 */
import { z } from "zod";
import { COLOR_IDS } from "../parts/colors";
import { CONFIG } from "../config";
import { detailTarget, type Detail } from "../detail";

export const CATEGORIES = ["vehicle", "building", "animal", "figure", "object", "scene"] as const;

export const PhotoAnalysisSchema = z.object({
  subject: z.string(),
  category: z.enum(CATEGORIES),
  /** Real-world size estimate in metres: length = front to back, width = side to side, height. */
  dimensions: z.object({ length: z.number().positive(), width: z.number().positive(), height: z.number().positive() }),
  keyFeatures: z.array(z.string()).min(1),
  colors: z.array(z.object({ area: z.string(), color: z.string() })),
  /** Camera direction relative to the subject: azimuth 0 = from the front, 90 = from its right side, ±180 = from behind; elevation = degrees above horizontal. */
  view: z.object({ azimuth: z.number(), elevation: z.number() }),
  notes: z.string(),
});
export type PhotoAnalysis = z.infer<typeof PhotoAnalysisSchema>;

export function analysisJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      subject: { type: "string", description: "What the subject is, as specifically as you can tell (make and model for vehicles)." },
      category: { type: "string", enum: [...CATEGORIES] },
      dimensions: {
        type: "object",
        properties: { length: { type: "number" }, width: { type: "number" }, height: { type: "number" } },
        required: ["length", "width", "height"],
        additionalProperties: false,
      },
      keyFeatures: { type: "array", items: { type: "string" } },
      colors: {
        type: "array",
        items: { type: "object", properties: { area: { type: "string" }, color: { type: "string", enum: COLOR_IDS } }, required: ["area", "color"], additionalProperties: false },
      },
      view: {
        type: "object",
        properties: { azimuth: { type: "integer" }, elevation: { type: "integer" } },
        required: ["azimuth", "elevation"],
        additionalProperties: false,
      },
      notes: { type: "string" },
    },
    required: ["subject", "category", "dimensions", "keyFeatures", "colors", "view", "notes"],
    additionalProperties: false,
  };
}

/**
 * The analysis's own short system prompt. It doesn't get the design prompt (part
 * menu, building rules): it designs nothing, and with its own schema and no cache
 * that prompt was ~12k tokens billed as uncached input on every photo build.
 */
export const ANALYSIS_SYSTEM = "You look at photos for a program that designs buildable models made of interlocking toy bricks. Describe the photo's main subject accurately in the requested JSON format: what it is, its real size and proportions, its defining features, its colours and the camera angle.";

export function analysisPrompt(extra?: string): string {
  return `Before anyone designs a brick model of the main subject in this photo, describe the subject so the model gets its proportions and character right. Don't design anything yet.

- subject: what it is, as specifically as you can (make and model for a vehicle, species for an animal, style for a building).
- category: vehicle, building, animal, figure, object or scene.
- dimensions: the subject's real-world size in metres — length (front to back), width (side to side), height (ground to top). Use known specifications if you recognise it (a car's published length, width and height); otherwise estimate from the photo. These set the model's proportions, so be accurate: a sports car is long, wide and very low; a van is tall.
- keyFeatures: 5–8 features that make it recognisable, most important first (e.g. "wedge-shaped nose", "large side air intakes behind the doors", "wheels large relative to the body").
- colors: the main areas and the closest palette colour for each (${COLOR_IDS.join(", ")}).
- view: where the camera is, relative to the subject — azimuth in degrees (0 = looking at its front, 90 = at its right side, -90 = at its left side, ±180 = at its back) and elevation in degrees above horizontal.
- notes: anything else a builder must get right or avoid (stance, overhangs, what to simplify).${extra?.trim() ? `\n\nThe user added: ${extra.trim()}` : ""}`;
}

export interface SizeTarget {
  /** Studs: x = width (side to side), z = length (front to back); plates: height. */
  width: number;
  length: number;
  heightPlates: number;
  parts: number;
}

/**
 * The model's target size: the subject's width at the Detail level's width
 * (vehicles at least CONFIG.detail.vehicleMinWidth), length and height in the
 * subject's real proportions (1 stud = 8 mm = 2.5 plates of 3.2 mm), scaled
 * down if needed to fit the build area.
 */
export function sizeTarget(a: Pick<PhotoAnalysis, "category" | "dimensions">, detail: Detail | undefined, grid: { x: number; z: number; y: number }): SizeTarget {
  const t = detailTarget(detail, { vehicle: a.category === "vehicle" });
  const { length, width, height } = a.dimensions;
  let scale = t.width / width; // studs per metre
  // Fit inside the build area (leave a stud of margin).
  scale = Math.min(scale, (grid.z - 2) / length, (grid.x - 2) / width, (grid.y - 2) / (height * 2.5));
  return {
    width: Math.max(1, Math.round(width * scale)),
    length: Math.max(1, Math.round(length * scale)),
    heightPlates: Math.max(1, Math.round(height * scale * 2.5)),
    parts: t.parts,
  };
}

/** The analysis and target size, as a block for the design / plan prompts. */
export function analysisBlock(a: PhotoAnalysis, target: SizeTarget, opts: { partLimit?: number } = {}): string {
  const parts = opts.partLimit ? Math.min(target.parts, opts.partLimit) : target.parts;
  const d = a.dimensions;
  return `Photo analysis (done before designing):
- Subject: ${a.subject} (${a.category})
- Real size: ${d.length} m long × ${d.width} m wide × ${d.height} m tall (length : width : height = ${(d.length / d.width).toFixed(2)} : 1 : ${(d.height / d.width).toFixed(2)})
- Key features: ${a.keyFeatures.map((f, i) => `${i + 1}. ${f}`).join("; ")}
- Colours: ${a.colors.map((c) => `${c.area}: ${c.color}`).join(", ")}
- Notes: ${a.notes}

Target size (keep these proportions; they matter more than detail): ${target.length} studs long (z, front to back) × ${target.width} studs wide (x) × about ${target.heightPlates} plates tall (${(target.heightPlates / 3).toFixed(1)} bricks), about ${parts} parts at most.
Orientation: the model's front faces +z (toward the viewer), its length runs along z, and its right side is at max x.`;
}

