import { describe, expect, it } from "vitest";

import { PUBLIC_TOOL_SCHEMAS } from "../../src/protocol.js";

type ObjectJsonSchema = Readonly<{
  type?: unknown;
  properties?: Readonly<Record<string, unknown>>;
  required?: readonly string[];
  additionalProperties?: unknown;
}>;

describe("public tool JSON Schema", () => {
  it("publishes exactly the two frozen tool contracts", () => {
    expect(PUBLIC_TOOL_SCHEMAS.map(({ name }) => name)).toEqual([
      "computer_observe",
      "computer_act",
    ]);

    const observe = PUBLIC_TOOL_SCHEMAS[0]?.inputSchema as ObjectJsonSchema;
    const act = PUBLIC_TOOL_SCHEMAS[1]?.inputSchema as ObjectJsonSchema;
    expect(observe.additionalProperties).toBe(false);
    expect(act.additionalProperties).toBe(false);
    expect(act.required).toEqual(["snapshot_id", "action"]);
    expect(act.properties).toHaveProperty("snapshot_id");
    expect(act.properties).toHaveProperty("action");
    expect(act.properties).not.toHaveProperty("actions");

    expect(PUBLIC_TOOL_SCHEMAS).toMatchInlineSnapshot(`
      [
        {
          "inputSchema": {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "additionalProperties": false,
            "properties": {},
            "type": "object",
          },
          "name": "computer_observe",
        },
        {
          "inputSchema": {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "additionalProperties": false,
            "properties": {
              "action": {
                "oneOf": [
                  {
                    "additionalProperties": false,
                    "properties": {
                      "type": {
                        "const": "click",
                        "type": "string",
                      },
                      "x": {
                        "minimum": 0,
                        "type": "number",
                      },
                      "y": {
                        "minimum": 0,
                        "type": "number",
                      },
                    },
                    "required": [
                      "type",
                      "x",
                      "y",
                    ],
                    "type": "object",
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "type": {
                        "const": "double_click",
                        "type": "string",
                      },
                      "x": {
                        "minimum": 0,
                        "type": "number",
                      },
                      "y": {
                        "minimum": 0,
                        "type": "number",
                      },
                    },
                    "required": [
                      "type",
                      "x",
                      "y",
                    ],
                    "type": "object",
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "type": {
                        "const": "right_click",
                        "type": "string",
                      },
                      "x": {
                        "minimum": 0,
                        "type": "number",
                      },
                      "y": {
                        "minimum": 0,
                        "type": "number",
                      },
                    },
                    "required": [
                      "type",
                      "x",
                      "y",
                    ],
                    "type": "object",
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "type": {
                        "const": "move",
                        "type": "string",
                      },
                      "x": {
                        "minimum": 0,
                        "type": "number",
                      },
                      "y": {
                        "minimum": 0,
                        "type": "number",
                      },
                    },
                    "required": [
                      "type",
                      "x",
                      "y",
                    ],
                    "type": "object",
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "duration_ms": {
                        "maximum": 10000,
                        "minimum": 0,
                        "type": "integer",
                      },
                      "from_x": {
                        "minimum": 0,
                        "type": "number",
                      },
                      "from_y": {
                        "minimum": 0,
                        "type": "number",
                      },
                      "to_x": {
                        "minimum": 0,
                        "type": "number",
                      },
                      "to_y": {
                        "minimum": 0,
                        "type": "number",
                      },
                      "type": {
                        "const": "drag",
                        "type": "string",
                      },
                    },
                    "required": [
                      "type",
                      "from_x",
                      "from_y",
                      "to_x",
                      "to_y",
                    ],
                    "type": "object",
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "amount": {
                        "maximum": 50,
                        "minimum": 1,
                        "type": "integer",
                      },
                      "by": {
                        "enum": [
                          "line",
                          "page",
                        ],
                        "type": "string",
                      },
                      "direction": {
                        "enum": [
                          "up",
                          "down",
                          "left",
                          "right",
                        ],
                        "type": "string",
                      },
                      "type": {
                        "const": "scroll",
                        "type": "string",
                      },
                      "x": {
                        "minimum": 0,
                        "type": "number",
                      },
                      "y": {
                        "minimum": 0,
                        "type": "number",
                      },
                    },
                    "required": [
                      "type",
                      "x",
                      "y",
                      "direction",
                      "amount",
                    ],
                    "type": "object",
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "text": {
                        "maxLength": 20000,
                        "type": "string",
                      },
                      "type": {
                        "const": "type",
                        "type": "string",
                      },
                    },
                    "required": [
                      "type",
                      "text",
                    ],
                    "type": "object",
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "keys": {
                        "items": {
                          "maxLength": 24,
                          "minLength": 1,
                          "pattern": "^[A-Za-z0-9_+-]+$",
                          "type": "string",
                        },
                        "maxItems": 8,
                        "minItems": 1,
                        "type": "array",
                      },
                      "type": {
                        "const": "keypress",
                        "type": "string",
                      },
                    },
                    "required": [
                      "type",
                      "keys",
                    ],
                    "type": "object",
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "ms": {
                        "maximum": 15000,
                        "minimum": 0,
                        "type": "integer",
                      },
                      "type": {
                        "const": "wait",
                        "type": "string",
                      },
                    },
                    "required": [
                      "type",
                      "ms",
                    ],
                    "type": "object",
                  },
                ],
              },
              "snapshot_id": {
                "pattern": "^snap_[A-Za-z0-9_-]{8,}$",
                "type": "string",
              },
            },
            "required": [
              "snapshot_id",
              "action",
            ],
            "type": "object",
          },
          "name": "computer_act",
        },
      ]
    `);
  });
});
