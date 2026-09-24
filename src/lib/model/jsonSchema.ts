import { codec } from "../diff/format";

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
        items: codec().placementSchema,
      },
    },
    required: ["name", "description", "parts"],
    additionalProperties: false,
  };
}
