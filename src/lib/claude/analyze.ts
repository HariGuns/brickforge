import type Anthropic from "@anthropic-ai/sdk";
import { searchPartsTool } from "./tools";
import { analysisJsonSchema, analysisPrompt, PhotoAnalysisSchema, sizeTarget, type PhotoAnalysis, type SizeTarget } from "../prompts/analysis";
import type { Detail } from "../detail";
import type { Issue } from "../validate/validator";
import { runLoop, type LoopContext, type RoundSummary } from "./loop";
import type { RoundUsage } from "./usage";
import { formatUsage } from "./usage";

export interface AnalysisResult {
  analysis: PhotoAnalysis;
  target: SizeTarget;
  rounds: RoundSummary[];
  usage: RoundUsage;
}

/** The photo analysis event: shown in the chat, its cost logged separately. */
export interface AnalysisEvent {
  type: "analysis";
  analysis: PhotoAnalysis;
  target: SizeTarget;
  cost: number;
}

/**
 * Photo analysis, before designing: what the subject is, its real proportions,
 * key features, colours and the camera angle; plus the target size that the
 * Detail level gives. One short call (one retry if the output doesn't parse).
 * Writes analysis.* files and analysis.json to the run's debug folder.
 */
export async function analyzePhoto(
  input: { text?: string; image: { mediaType: Anthropic.Base64ImageSource["media_type"]; data: string }; detail?: Detail },
  grid: { x: number; z: number; y: number },
  ctx: LoopContext,
  system: string,
): Promise<AnalysisResult> {
  const text = analysisPrompt(input.text);
  const loop = await runLoop<PhotoAnalysis>(
    {
      scope: "analysis",
      debugPrefix: "analysis.",
      system,
      firstContent: [{ type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.data } }, { type: "text", text }],
      firstText: text,
      schema: analysisJsonSchema(),
      stage: "analysis",
      // Same tools as the design stages (not callable here), so the cached prefix is shared.
      tools: [searchPartsTool],
      toolChoice: "none",
      maxRepairRounds: 1,
      parse: (raw) => {
        try {
          const r = PhotoAnalysisSchema.safeParse(JSON.parse(raw));
          if (r.success) return { value: r.data, issues: [] };
          return { value: null, issues: [invalid(`The analysis didn't match the format: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`)] };
        } catch (e) {
          return { value: null, issues: [invalid(`Output was not valid JSON (${(e as Error).message}).`)] };
        }
      },
      check: () => ({ errors: [], warnings: [], valid: true, partCount: 0 }),
      repairText: (errors) => `${errors.map((e) => e.message).join("\n")}\nReturn the analysis again in the required format.`,
    },
    ctx,
  );
  if (!loop.best) throw new Error("Couldn't analyse the photo.");
  const analysis = loop.best.value;
  const target = sizeTarget(analysis, input.detail, grid);
  ctx.debug.write("analysis.json", { analysis, target, detail: input.detail ?? "standard", usage: loop.usage });
  console.log(`[generate] photo analysis: ${analysis.subject} (${analysis.category}) → ${target.length}×${target.width} studs, ${target.heightPlates} plates · ${formatUsage(loop.usage)}`);
  return { analysis, target, rounds: loop.rounds, usage: loop.usage };
}

const invalid = (message: string): Issue => ({ code: "INVALID_OUTPUT", severity: "error", parts: [], message });
