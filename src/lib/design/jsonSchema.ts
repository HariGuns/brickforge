import { PART_IDS } from "../parts/library";
import { COLOR_IDS } from "../parts/colors";

/** JSON schema for a whole design (structured output for design edits). Keep in sync with BrickDesignSchema. */
export function designJsonSchema(): Record<string, unknown> {
  const placement = {
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
  };
  const instance = {
    type: "object",
    properties: { sub: { type: "string" }, x: { type: "integer" }, y: { type: "integer" }, z: { type: "integer" }, rot: { type: "integer", enum: [0, 90, 180, 270] } },
    required: ["sub", "x", "y", "z", "rot"],
    additionalProperties: false,
  };
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
