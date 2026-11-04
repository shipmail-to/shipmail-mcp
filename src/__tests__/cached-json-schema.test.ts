import { describe, expect, spyOn, test } from "bun:test";
import { z } from "zod/v4";

import { openOutputSchema, withCachedJsonSchema } from "../output-schema.js";

const options = { target: "draft-2020-12" } as const;

describe("withCachedJsonSchema", () => {
  test("converts a schema once and keeps validating with the original", async () => {
    const schema = z.object({ id: z.string() });
    const convert = spyOn(schema["~standard"].jsonSchema, "input");

    const first = withCachedJsonSchema(schema);
    const second = withCachedJsonSchema(schema);
    expect(second).toBe(first);
    expect(first["~standard"].jsonSchema.input(options)).toBe(
      second["~standard"].jsonSchema.input(options),
    );
    expect(convert).toHaveBeenCalledTimes(1);
    expect(await first["~standard"].validate({ id: 1 })).toHaveProperty("issues");
  });

  test("converts again for library options it cannot key on", () => {
    const schema = z.object({ id: z.string() });
    const convert = spyOn(schema["~standard"].jsonSchema, "input");
    const cached = withCachedJsonSchema(schema);

    cached["~standard"].jsonSchema.input({
      ...options,
      libraryOptions: { unrepresentable: "any" },
    });
    cached["~standard"].jsonSchema.input({
      ...options,
      libraryOptions: { unrepresentable: "any" },
    });
    expect(convert).toHaveBeenCalledTimes(2);
  });

  test("gives one opened output schema per source schema", () => {
    const schema = z.object({ status: z.enum(["ok"]) });

    const opened = openOutputSchema(schema);
    expect(openOutputSchema(schema)).toBe(opened);
    expect(opened["~standard"].jsonSchema.output(options)).toBe(
      opened["~standard"].jsonSchema.output(options),
    );
  });
});
