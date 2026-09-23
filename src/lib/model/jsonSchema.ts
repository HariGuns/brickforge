import { PART_IDS } from "../parts/library";
import { COLOR_IDS } from "../parts/colors";

/**
 * JSON schema for Claude's structured output (output_config.format). Written by
 * hand (rather than derived from Zod) so enums and integer types are enforced by
 * the API. Keep in sync with BrickModelSchema in schema.ts.
 */
export function brickModelJsonSchema() {
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      parts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            part: { type: "string", enum: PART_IDS },
            color: { type: "string", enum: COLOR_IDS },
            x: { type: "integer" },
            y: { type: "integer" },
            z: { type: "integer" },
            rot: { type: "integer", enum: [0, 90, 180, 270] },
          },
          required: ["part", "color", "x", "y", "z", "rot"],
          additionalProperties: false,
        },
      },
    },
    required: ["name", "description", "parts"],
    additionalProperties: false,
  } as const;
}
