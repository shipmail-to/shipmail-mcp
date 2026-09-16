import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";

// Zod emits `additionalProperties: false` for every object when it converts a schema with
// `io: "output"`, at every nesting level. Published that way, an output schema makes every field
// Shipmail adds later a breaking change: a long-lived client that cached the schema before the
// field existed rejects every response carrying it ("must NOT have additional properties"), which
// is exactly how adding `conversation_id` broke live MCP connections. An output schema therefore
// describes what a response is guaranteed to contain, never the complete set of keys it may carry.
//
// The same reasoning closes over the values a field may take. Zod emits `enum` for `z.enum(...)`
// and `const` for `z.literal(...)`, so a client that cached the schema before `skipped` joined the
// import folder states rejects every response that reports a skipped folder. A published output
// schema states that a field is a string, never the closed set of strings it may become, so string
// `enum` and string `const` are dropped and `type: "string"` plus any `description` stay.
//
// The openness is applied to the converted JSON Schema rather than to each Zod shape, so one helper
// covers every tool and no new schema can close itself by accident. Argument (`io: "input"`)
// schemas are untouched: rejecting unknown arguments and unknown argument values is deliberate
// there.

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

// A node is string-typed when it says so, or when it carries no `type` at all and its own
// `enum`/`const` values decide the question. Numeric and boolean literal sets stay: they are small
// closed domains that do not grow the way a status vocabulary does.
function isStringTyped(node: Record<string, unknown>): boolean {
  const type = node["type"];
  if (type === undefined) return true;
  if (Array.isArray(type)) return type.includes("string");
  return type === "string";
}

function isStringEnum(value: unknown): boolean {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string")
  );
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
  const stringTyped = isStringTyped(node);
  // Zod converts a discriminated union to `oneOf`, which demands that exactly one branch match.
  // The branches are told apart by the discriminator's `const`, so dropping those constants would
  // let one response satisfy several branches and be rejected for matching too many. `anyOf` is
  // the same list of branches without that arithmetic, and it only ever accepts more.
  const mergeUnion = Object.hasOwn(node, "oneOf");
  const union: unknown[] = [];
  for (const keyword of Object.getOwnPropertyNames(node)) {
    const value = node[keyword];
    if (value === false && CLOSING_KEYWORDS.has(keyword)) continue;
    if (stringTyped && keyword === "enum" && isStringEnum(value)) continue;
    if (stringTyped && keyword === "const" && typeof value === "string") continue;
    if (mergeUnion && (keyword === "oneOf" || keyword === "anyOf") && Array.isArray(value)) {
      union.push(...value.map((branch) => openSchemaValue(branch)));
      continue;
    }
    if (SCHEMA_RECORD_KEYWORDS.has(keyword)) {
      opened[keyword] = openSchemaRecord(value);
      continue;
    }
    opened[keyword] = SCHEMA_KEYWORDS.has(keyword) ? openSchemaValue(value) : value;
  }
  if (union.length > 0) opened["anyOf"] = union;
  return opened;
}

/**
 * Returns the JSON Schema opened at every nesting level: every object accepts properties it does
 * not list, and every string field accepts values its `enum` or `const` does not list. Other
 * annotation keywords (`description`, `examples`, …) and non-string `enum`/`const` are copied
 * through untouched.
 */
export function openJsonSchemaObjects(schema: Record<string, unknown>): Record<string, unknown> {
  return openSchemaNode(schema);
}

/**
 * Wraps an output schema so the JSON Schema it publishes accepts fields and string values added
 * later, while runtime validation keeps using the original schema unchanged.
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
