import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { ShipmailClient } from "shipmail";

import { MCP_CAPABILITIES } from "../capabilities.js";
import {
  createSegmentInputSchema,
  segmentOutputSchema,
  segmentsOutputSchema,
  updateSegmentInputSchema,
} from "../schemas.js";
import { registerTools } from "../tools.js";

const SEGMENT = {
  object: "segment",
  id: "nwsseg_1",
  audience_id: "aud_1",
  name: "Founders",
  definition: {
    match: "all",
    rules: [{ kind: "merge_field", field: "role", operator: "equals", value: "founder" }],
  },
  matching_count: 3,
  created_at: "2026-11-03T10:00:00.000Z",
  updated_at: "2026-11-03T10:00:00.000Z",
} as const;

const SEGMENT_TOOLS = [
  "shipmail_list_audience_segments",
  "shipmail_create_audience_segment",
  "shipmail_get_audience_segment",
  "shipmail_update_audience_segment",
  "shipmail_delete_audience_segment",
] as const;

type Captured = { readonly method: string; readonly path: string; readonly body: unknown };

async function callTool(name: string, args: Record<string, unknown>, response?: Response) {
  const requests: Captured[] = [];
  const fetchImpl: typeof fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = new URL(String(input)).pathname;
      requests.push({
        method,
        path,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      if (response) return response;
      if (method === "DELETE") return new Response(null, { status: 204 });
      if (method === "GET" && path.endsWith("/segments")) return Response.json({ data: [SEGMENT] });
      return Response.json(SEGMENT, { status: method === "POST" ? 201 : 200 });
    },
    { preconnect: () => undefined },
  );
  const shipmail = new ShipmailClient({
    apiKey: "sk_test",
    baseUrl: "https://shipmail.to/api/v1",
    maxRetries: 0,
    fetch: fetchImpl,
  });
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, shipmail, new Set(SEGMENT_TOOLS));
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return { result: await client.callTool({ name, arguments: args }), requests };
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

describe("segment input schemas", () => {
  test("accept every rule kind the API accepts", () => {
    const parsed = createSegmentInputSchema.parse({
      audience_id: "aud_1",
      name: " Active ",
      definition: {
        match: "any",
        rules: [
          { kind: "merge_field", field: "plan", operator: "is_set" },
          { kind: "join_date", operator: "on_or_after", value: "2026-01-01" },
          { kind: "engagement_tier", operator: "is", value: "engaged" },
          { kind: "last_sign_of_life", operator: "within_days", value: 30 },
          { kind: "issues_received", operator: "at_least", value: 0 },
        ],
      },
    });
    expect(parsed.name).toBe("Active");
  });

  test("reject what the API rejects", () => {
    const base = { audience_id: "aud_1", name: "X" };
    const rule = { kind: "issues_received", operator: "at_most", value: 1 };
    for (const definition of [
      { match: "all", rules: [] },
      { match: "all", rules: Array.from({ length: 11 }, () => rule) },
      { match: "some", rules: [rule] },
      { match: "all", rules: [{ kind: "merge_field", field: "Bad-Key", operator: "is_set" }] },
      {
        match: "all",
        rules: [{ kind: "merge_field", field: "a", operator: "is_set", value: "x" }],
      },
      { match: "all", rules: [{ kind: "join_date", operator: "before", value: "yesterday" }] },
      { match: "all", rules: [{ kind: "last_sign_of_life", operator: "within_days", value: 0 }] },
    ]) {
      expect(createSegmentInputSchema.safeParse({ ...base, definition }).success).toBe(false);
    }
    expect(createSegmentInputSchema.safeParse({ ...base, name: "x".repeat(121) }).success).toBe(
      false,
    );
  });

  test("update needs a name or a definition", () => {
    expect(
      updateSegmentInputSchema.safeParse({ audience_id: "aud_1", segment_id: "nwsseg_1" }).success,
    ).toBe(false);
    expect(
      updateSegmentInputSchema.safeParse({
        audience_id: "aud_1",
        segment_id: "seg_1",
        name: "Renamed",
      }).success,
    ).toBe(false);
  });
});

describe("segment capabilities", () => {
  test("read tools need audiences:read and writes audiences:write; delete is destructive", () => {
    const byName = new Map(MCP_CAPABILITIES.map((item) => [item.toolName, item]));
    expect(byName.get("shipmail_list_audience_segments")?.requiredScope).toBe("audiences:read");
    expect(byName.get("shipmail_get_audience_segment")?.requiredScope).toBe("audiences:read");
    for (const name of [
      "shipmail_create_audience_segment",
      "shipmail_update_audience_segment",
      "shipmail_delete_audience_segment",
    ] as const) {
      expect(byName.get(name)?.requiredScope).toBe("audiences:write");
    }
    expect(byName.get("shipmail_delete_audience_segment")?.annotations.destructiveHint).toBe(true);
    expect(byName.get("shipmail_create_audience_segment")?.annotations.openWorldHint).toBe(false);
  });
});

describe("segment tools", () => {
  test("list returns the segments with their matching counts", async () => {
    const { result, requests } = await callTool("shipmail_list_audience_segments", {
      audience_id: "aud_1",
    });
    expect(result.isError).toBeFalsy();
    expect(segmentsOutputSchema.parse(result.structuredContent).data[0]?.matching_count).toBe(3);
    expect(requests).toEqual([
      { method: "GET", path: "/api/v1/audiences/aud_1/segments", body: null },
    ]);
  });

  test("create, get and update call the segment endpoints", async () => {
    const created = await callTool("shipmail_create_audience_segment", {
      audience_id: "aud_1",
      name: "Founders",
      definition: SEGMENT.definition,
      idempotency_key: "seg-create-1",
    });
    expect(segmentOutputSchema.parse(created.result.structuredContent).segment.id).toBe("nwsseg_1");
    expect(created.requests).toEqual([
      {
        method: "POST",
        path: "/api/v1/audiences/aud_1/segments",
        body: { name: "Founders", definition: SEGMENT.definition },
      },
    ]);

    const got = await callTool("shipmail_get_audience_segment", {
      audience_id: "aud_1",
      segment_id: "nwsseg_1",
    });
    expect(got.requests[0]?.path).toBe("/api/v1/audiences/aud_1/segments/nwsseg_1");

    const updated = await callTool("shipmail_update_audience_segment", {
      audience_id: "aud_1",
      segment_id: "nwsseg_1",
      name: "All founders",
    });
    expect(updated.requests).toEqual([
      {
        method: "PATCH",
        path: "/api/v1/audiences/aud_1/segments/nwsseg_1",
        body: { name: "All founders" },
      },
    ]);
  });

  test("delete acknowledges a 204 and reports a 409 conflict as an error", async () => {
    const deleted = await callTool("shipmail_delete_audience_segment", {
      audience_id: "aud_1",
      segment_id: "nwsseg_1",
    });
    expect(deleted.result.isError).toBeFalsy();
    expect(deleted.result.structuredContent).toEqual({ result: { ok: true, id: "nwsseg_1" } });
    expect(deleted.requests[0]?.method).toBe("DELETE");

    const refused = await callTool(
      "shipmail_delete_audience_segment",
      { audience_id: "aud_1", segment_id: "nwsseg_1" },
      Response.json(
        {
          error: {
            type: "conflict",
            message: "This segment is selected by a newsletter.",
          },
        },
        { status: 409 },
      ),
    );
    expect(refused.result.isError).toBe(true);
  });
});
