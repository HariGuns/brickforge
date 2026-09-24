import { codec } from "../diff/format";

/** JSON schema for a whole design (structured output for design edits). Keep in sync with BrickDesignSchema. */
export function designJsonSchema(): Record<string, unknown> {
  const c = codec();
  const placement = c.placementSchema;
  const instance = c.instanceSchema;
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      subBuilds: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, name: { type: "string" }, parts: { type: "array", items: placement }, uses: { type: "array", items: instance } },
          required: ["id", "name", "parts", "uses"],
          additionalProperties: false,
        },
      },
      main: {
        type: "object",
        properties: { parts: { type: "array", items: placement }, uses: { type: "array", items: instance } },
        required: ["parts", "uses"],
        additionalProperties: false,
      },
    },
    required: ["name", "description", "subBuilds", "main"],
    additionalProperties: false,
  };
}
