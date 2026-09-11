import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";

// Zod emits `additionalProperties: false` for every object when it converts a schema with
// `io: "output"`, at every nesting level. Published that way, an output schema makes every field
// Shipmail adds later a breaking change: a long-lived client that cached the schema before the
// field existed rejects every response carrying it ("must NOT have additional properties"), which
// is exactly how adding `conversation_id` broke live MCP connections. An output schema therefore
// describes what a response is guaranteed to contain, never the complete set of keys it may carry.
//
// The openness is applied to the converted JSON Schema rather than to each Zod shape, so one helper
// covers every tool and no new schema can close itself by accident. Argument (`io: "input"`)
// schemas are untouched: rejecting unknown arguments is deliberate there.

// Keywords whose value is a single schema, or a list of them for `items` on pre-2020-12 targets.
const SCHEMA_KEYWORDS = new Set<string>([
  "additionalItems",
  "additionalProperties",
  "contains",
  "else",
  "if",
  "items",
  "not",
  "propertyNames",
  "prefixItems",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
  "allOf",
  "anyOf",
  "oneOf",
]);

// Keywords whose value is a record of schemas keyed by a name the schema author chose. Recursing
// into the values only, never the keys, is what keeps a property legitimately named
// "additionalProperties" from being mistaken for the keyword.
const SCHEMA_RECORD_KEYWORDS = new Set<string>([
  "$defs",
  "definitions",
  "dependentSchemas",
  "patternProperties",
  "properties",
]);

// Keywords that close an object to keys the schema does not list. Dropping one restores the JSON
// Schema default, which is to allow them.
const CLOSING_KEYWORDS = new Set<string>(["additionalProperties", "unevaluatedProperties"]);

function isSchemaNode(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function openSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => openSchemaValue(entry));
  return isSchemaNode(value) ? openSchemaNode(value) : value;
}

function openSchemaRecord(value: unknown): unknown {
  if (!isSchemaNode(value)) return value;
  const opened: Record<string, unknown> = {};
  for (const name of Object.getOwnPropertyNames(value)) {
    opened[name] = openSchemaValue(value[name]);
  }
  return opened;
}

function openSchemaNode(node: Record<string, unknown>): Record<string, unknown> {
  const opened: Record<string, unknown> = {};
  for (const keyword of Object.getOwnPropertyNames(node)) {
    const value = node[keyword];
    if (value === false && CLOSING_KEYWORDS.has(keyword)) continue;
    if (SCHEMA_RECORD_KEYWORDS.has(keyword)) {
      opened[keyword] = openSchemaRecord(value);
      continue;
    }
    opened[keyword] = SCHEMA_KEYWORDS.has(keyword) ? openSchemaValue(value) : value;
  }
  return opened;
}

/**
 * Returns the JSON Schema with every object opened to properties it does not list, at every
 * nesting level. Annotation keywords (`description`, `enum`, `const`, `examples`, …) are copied
 * through untouched.
 */
export function openJsonSchemaObjects(schema: Record<string, unknown>): Record<string, unknown> {
  return openSchemaNode(schema);
}

/**
 * Wraps an output schema so the JSON Schema it publishes accepts fields added later, while runtime
 * validation keeps using the original schema unchanged.
 */
export function openOutputSchema(schema: StandardSchemaWithJSON): StandardSchemaWithJSON {
  const standard = schema["~standard"];
  return {
    "~standard": {
      ...standard,
      jsonSchema: {
        input: (options) => standard.jsonSchema.input(options),
        output: (options) => openJsonSchemaObjects(standard.jsonSchema.output(options)),
      },
    },
  };
}
