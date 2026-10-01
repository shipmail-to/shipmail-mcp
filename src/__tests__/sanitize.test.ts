import { describe, expect, test } from "bun:test";

import { sanitizeRecord, sanitizeString, sanitizeValue } from "../sanitize.js";

describe("sanitizeString", () => {
  test("preserves benign text", () => {
    expect(sanitizeString("hello world")).toBe("hello world");
  });

  test("preserves tab, newline, carriage return", () => {
    expect(sanitizeString("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });

  test("strips ASCII control characters", () => {
    expect(sanitizeString("hi\x00\x01\x02there")).toBe("hithere");
  });

  test("strips DEL", () => {
    expect(sanitizeString("a\x7Fb")).toBe("ab");
  });

  test("strips Unicode BiDi override and isolate ranges", () => {
    expect(sanitizeString("a‮b‬c⁦d⁩e")).toBe("abcde");
  });

  test("strips invisible directional markers (LRM, RLM, ALM)", () => {
    // U+200E LRM, U+200F RLM, U+061C ALM. These do not flip layout as
    // dramatically as the override block but are still invisible smuggling
    // vectors for adversarial content fed back to the LLM.
    expect(sanitizeString("a‎b‏c؜d")).toBe("abcd");
  });

  test("strips zero-width space, word joiner, BOM and Unicode tag characters", () => {
    const hidden = "\u{E0001}\u{E0069}\u{E0067}\u{E006E}\u{E007F}";
    expect(sanitizeString(`a\u200Bb\u2060c\uFEFFd${hidden}e`)).toBe("abcde");
  });

  test("keeps ZWNJ and ZWJ, which real text needs", () => {
    const persian = "\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645";
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    expect(sanitizeString(persian)).toBe(persian);
    expect(sanitizeString(family)).toBe(family);
  });

  test("truncates long strings with marker", () => {
    const long = "a".repeat(20_000);
    const out = sanitizeString(long, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith("[truncated]")).toBe(true);
  });
});

describe("sanitizeValue", () => {
  test("recursively sanitizes nested strings", () => {
    const input = {
      subject: "hi‮there",
      from: { name: "evil\x00name", address: "a@b" },
      tags: ["ok", "bad\x07tag"],
    };
    const out = sanitizeValue(input) as Record<string, unknown>;
    expect(out["subject"] as string).toBe("hithere");
    const from = out["from"] as Record<string, unknown>;
    expect(from["name"]).toBe("evilname");
    expect(out["tags"]).toEqual(["ok", "badtag"]);
  });

  test("preserves null, numbers, booleans", () => {
    const out = sanitizeValue({ a: null, b: 42, c: true });
    expect(out).toEqual({ a: null, b: 42, c: true });
  });
});

describe("sanitizeRecord", () => {
  test("returns a new record with string values sanitized", () => {
    const out = sanitizeRecord({ message: "hello\x00world" });
    expect(out["message"]).toBe("helloworld");
  });
});
