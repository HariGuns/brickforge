import { BrickModelSchema, type BrickModel } from "../model/schema";
import { compileDesign } from "./compile";
import { BrickDesignSchema, type BrickDesign } from "./schema";

const issues = (e: { issues: { path: PropertyKey[]; message: string }[] }) =>
  e.issues
    .slice(0, 3)
    .map((i) => `${i.path.map(String).join(".")}: ${i.message}`)
    .join("; ");

/**
 * Read a JSON file the app can open: a flat model ({ parts }) or a design with
 * sub-builds ({ subBuilds, main }), as the Design tab downloads them. A design
 * is compiled to get its model.
 */
export function parseModelFile(text: string): { model: BrickModel; design?: BrickDesign } {
  const json: unknown = JSON.parse(text);
  if (json && typeof json === "object" && "main" in json) {
    const parsed = BrickDesignSchema.safeParse(json);
    if (!parsed.success) throw new Error(`Not a valid design: ${issues(parsed.error)}`);
    const compiled = compileDesign(parsed.data);
    if (!compiled.model.parts.length) throw new Error(compiled.errors[0]?.message ?? "The design has no parts");
    return { model: compiled.model, design: parsed.data };
  }
  const parsed = BrickModelSchema.safeParse(json);
  if (!parsed.success) throw new Error(issues(parsed.error));
  return { model: parsed.data };
}
