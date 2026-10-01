const MAX_STRING_LENGTH = 16_384;
const TRUNCATION_MARKER = "\n…[truncated]";

// Strip ASCII control characters (except tab/newline/CR), DEL, and invisible
// Unicode that can hide instructions from a human reviewing text that flows
// back to the LLM: U+061C (ALM), U+200E/U+200F (LRM/RLM), U+202A-U+202E
// (LRE/RLE/PDF/LRO/RLO), U+2066-U+2069 (LRI/RLI/FSI/PDI), U+200B (zero-width
// space), U+2060 (word joiner), U+FEFF (BOM) and the U+E0000-U+E007F tag block.
// ZWNJ and ZWJ (U+200C/U+200D) stay: Persian, Indic scripts and emoji need them.
const DANGEROUS_CHARS_REGEX =
  // eslint-disable-next-line no-control-regex
  /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u061C\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu;

export function sanitizeString(value: string, maxLength: number = MAX_STRING_LENGTH): string {
  const stripped = value.replace(DANGEROUS_CHARS_REGEX, "");
  if (stripped.length <= maxLength) return stripped;
  const keep = Math.max(0, maxLength - TRUNCATION_MARKER.length);
  return stripped.slice(0, keep) + TRUNCATION_MARKER;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A single string field, addressed by object keys from the root, that may exceed
// the default length limit. Every other string keeps the default.
export type LongStringField = { readonly path: readonly string[]; readonly maxLength: number };

function childField(field: LongStringField | undefined, key: string): LongStringField | undefined {
  return field !== undefined && field.path[0] === key
    ? { path: field.path.slice(1), maxLength: field.maxLength }
    : undefined;
}

// Recursively sanitize all string values inside a JSON-serializable value.
// Returns unknown so callers think about the runtime shape they are accepting
// from upstream APIs and apply Zod validation when they need a typed result.
export function sanitizeValue(value: unknown, longField?: LongStringField): unknown {
  if (typeof value === "string") {
    return sanitizeString(value, longField?.path.length === 0 ? longField.maxLength : undefined);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (isPlainObject(value)) {
    return sanitizeRecord(value, longField);
  }
  return value;
}

export function sanitizeRecord(
  value: Record<string, unknown>,
  longField?: LongStringField,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = sanitizeValue(item, childField(longField, key));
  }
  return out;
}
