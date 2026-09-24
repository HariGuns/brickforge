import { COLOR_IDS } from "../parts/colors";

/**
 * JSON schema for Claude's structured output (output_config.format). Written by
 * hand (rather than derived from Zod) so colour/rotation enums and integer types
 * are enforced by the API. Part ids are free strings (the catalog is too big for
 * an enum); the validator reports unknown ones with suggestions. Keep in sync with BrickModelSchema in schema.ts.
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
            // Not an enum: the catalog is too large; unknown ids are reported by the validator.
            part: { type: "string" },
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
