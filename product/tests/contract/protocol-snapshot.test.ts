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
    expect(observe.properties).toHaveProperty("target");
    expect(observe.properties).toHaveProperty("discover");
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
            "properties": {
              "discover": {
                "additionalProperties": false,
                "properties": {
                  "apps": {
                    "type": "boolean",
                  },
                  "query": {
                    "maxLength": 200,
                    "minLength": 1,
                    "type": "string",
                  },
                  "window_app_ref": {
                    "pattern": "^app_[A-Za-z0-9_-]{16,}$",
                    "type": "string",
                  },
                  "windows": {
                    "type": "boolean",
                  },
                },
                "type": "object",
              },
              "elements": {
                "additionalProperties": false,
                "properties": {
                  "max_depth": {
                    "maximum": 12,
                    "minimum": 1,
                    "type": "integer",
                  },
                  "max_elements": {
                    "maximum": 150,
                    "minimum": 1,
                    "type": "integer",
                  },
                  "query": {
                    "maxLength": 200,
                    "minLength": 1,
                    "type": "string",
                  },
                },
                "type": "object",
              },
              "include_screenshot": {
                "type": "boolean",
              },
              "target": {
                "anyOf": [
                  {
                    "additionalProperties": false,
                    "properties": {
                      "kind": {
                        "const": "desktop",
                        "type": "string",
                      },
                    },
                    "required": [
                      "kind",
                    ],
                    "type": "object",
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "kind": {
                        "const": "window",
                        "type": "string",
                      },
                      "window_ref": {
                        "pattern": "^win_[A-Za-z0-9_-]{16,}$",
                        "type": "string",
                      },
                    },
                    "required": [
                      "kind",
                      "window_ref",
                    ],
                    "type": "object",
                  },
                ],
              },
            },
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
                "anyOf": [
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
                      "element_ref": {
                        "pattern": "^el_[A-Za-z0-9_-]{16,}$",
                        "type": "string",
                      },
                      "type": {
                        "const": "click",
                        "type": "string",
                      },
                    },
                    "required": [
                      "type",
                      "element_ref",
                    ],
                    "type": "object",
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "element_ref": {
                        "pattern": "^el_[A-Za-z0-9_-]{16,}$",
                        "type": "string",
                      },
                      "type": {
                        "const": "double_click",
                        "type": "string",
                      },
                    },
                    "required": [
                      "type",
                      "element_ref",
                    ],
                    "type": "object",
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "element_ref": {
                        "pattern": "^el_[A-Za-z0-9_-]{16,}$",
                        "type": "string",
                      },
                      "type": {
                        "const": "right_click",
                        "type": "string",
                      },
                    },
                    "required": [
                      "type",
                      "element_ref",
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
                      "element_ref": {
                        "pattern": "^el_[A-Za-z0-9_-]{16,}$",
                        "type": "string",
                      },
                      "type": {
                        "const": "scroll",
                        "type": "string",
                      },
                    },
                    "required": [
                      "type",
                      "element_ref",
                      "direction",
                      "amount",
                    ],
                    "type": "object",
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "element_ref": {
                        "pattern": "^el_[A-Za-z0-9_-]{16,}$",
                        "type": "string",
                      },
                      "type": {
                        "const": "set_value",
                        "type": "string",
                      },
                      "value": {
                        "maxLength": 20000,
                        "type": "string",
                      },
                    },
                    "required": [
                      "type",
                      "element_ref",
                      "value",
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
                      "element_ref": {
                        "pattern": "^el_[A-Za-z0-9_-]{16,}$",
                        "type": "string",
                      },
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
                      "element_ref",
                      "text",
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
                      "text",
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
                        "const": "type_text",
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
                      "element_ref": {
                        "pattern": "^el_[A-Za-z0-9_-]{16,}$",
                        "type": "string",
                      },
                      "text": {
                        "maxLength": 20000,
                        "type": "string",
                      },
                      "type": {
                        "const": "type_text",
                        "type": "string",
                      },
                    },
                    "required": [
                      "type",
                      "element_ref",
                      "text",
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
                        "const": "type_text",
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
                      "element_ref": {
                        "pattern": "^el_[A-Za-z0-9_-]{16,}$",
                        "type": "string",
                      },
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
                      "element_ref",
                      "keys",
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
                      "keys",
                    ],
                    "type": "object",
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "path": {
                        "items": {
                          "maxLength": 200,
                          "minLength": 1,
                          "type": "string",
                        },
                        "maxItems": 16,
                        "minItems": 1,
                        "type": "array",
                      },
                      "type": {
                        "const": "invoke_menu",
                        "type": "string",
                      },
                    },
                    "required": [
                      "type",
                      "path",
                    ],
                    "type": "object",
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "app_ref": {
                        "pattern": "^app_[A-Za-z0-9_-]{16,}$",
                        "type": "string",
                      },
                      "type": {
                        "const": "launch_app",
                        "type": "string",
                      },
                    },
                    "required": [
                      "type",
                      "app_ref",
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
              "delivery": {
                "enum": [
                  "background",
                  "foreground",
                ],
                "type": "string",
              },
              "expect": {
                "additionalProperties": false,
                "properties": {
                  "element": {
                    "additionalProperties": false,
                    "properties": {
                      "element_ref": {
                        "pattern": "^el_[A-Za-z0-9_-]{16,}$",
                        "type": "string",
                      },
                      "enabled": {
                        "type": "boolean",
                      },
                      "selected": {
                        "type": "boolean",
                      },
                      "value_equals": {
                        "maxLength": 20000,
                        "type": "string",
                      },
                    },
                    "required": [
                      "element_ref",
                    ],
                    "type": "object",
                  },
                  "timeout_ms": {
                    "maximum": 10000,
                    "minimum": 0,
                    "type": "integer",
                  },
                },
                "required": [
                  "element",
                ],
                "type": "object",
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
