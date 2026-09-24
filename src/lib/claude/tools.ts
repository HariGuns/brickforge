import { searchParts, searchResultText, SEARCH_CATEGORIES } from "../parts/search";
import type { LoopTool } from "./loop";

/** search_parts: keyword search over the whole part catalog (the prompt only lists the core menu). */
export const searchPartsTool: LoopTool = {
  def: {
    name: "search_parts",
    description:
      "Search the full part catalog (core menu plus ~800 more parts made from the LDraw library) by what a part is: its kind, shape and size, e.g. \"curved slope 4x1\", \"wedge plate 2x4 right\", \"windscreen 3x4\", \"mudguard\", \"wheel\", \"tile 1x6\", \"grille\". Returns up to 12 parts with id, name, footprint, height, studs, underside connections and notes (wheel pins, hubs). Only use part ids from the core menu or from these results.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you're looking for: kind, shape and/or size (e.g. \"curved slope 2x4\")." },
        category: { type: "string", enum: SEARCH_CATEGORIES, description: "Optional: only this category." },
      },
      required: ["query"],
    },
  },
  run(input) {
    const query = String(input.query ?? "").slice(0, 200);
    const category = typeof input.category === "string" && (SEARCH_CATEGORIES as string[]).includes(input.category) ? input.category : undefined;
    const ids = searchParts(query, { category, limit: 12 }).map((p) => p.id);
    return { text: searchResultText(query, category), summary: `"${query}"${category ? ` [${category}]` : ""} → ${ids.slice(0, 6).join(", ")}${ids.length > 6 ? ` +${ids.length - 6}` : ""}` };
  },
};
