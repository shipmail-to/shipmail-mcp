import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { ShipmailClient } from "shipmail";

import {
  getAllowedMcpToolNames,
  getMcpCapability,
  permissionGroupsToScopes,
} from "../capabilities.js";
import { createInboxDraftInputSchema } from "../schemas.js";
import { registerTools } from "../tools.js";

type StubFetch = (...args: Parameters<typeof fetch>) => Promise<Response>;

type CapturedRequest = {
  readonly method: string;
  readonly path: string;
  readonly idempotencyKey: string | null;
  readonly body: unknown;
};

const MAILBOX_ID = "mbx_0123456789abcdefghjkmnpq";

function stubFetch(handler: StubFetch): typeof fetch {
  return Object.assign(handler, {
    preconnect(_url: string | URL): void {
      // Tests never preconnect.
    },
  });
}

async function buildPair(captured: CapturedRequest[], allowedTools?: ReadonlySet<string>) {
  const shipmail = new ShipmailClient({
    apiKey: "sm_live_test",
    baseUrl: "https://shipmail.to/api/v1",
    maxRetries: 0,
    fetch: stubFetch(async (input, init) => {
      const headers = new Headers(init?.headers);
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      captured.push({
        method: init?.method ?? "GET",
        path: new URL(String(input)).pathname,
        idempotencyKey: headers.get("idempotency-key"),
        body,
      });
      return Response.json(
        {
          object: "inbox_draft",
          id: "eml_draft_1",
          mailbox_id: MAILBOX_ID,
          from: { address: "founder@example.com", name: null },
          to: [{ address: "jane@example.com", name: "Jane" }],
          cc: [],
          bcc: [],
          subject: "Quick intro",
          created_at: "2026-09-24T12:00:00.000Z",
        },
        { status: 201 },
      );
    }),
  });
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, shipmail, allowedTools);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("shipmail_create_draft", () => {
  test("saves a new message draft through the mailbox drafts endpoint", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);

    const result = await client.callTool({
      name: "shipmail_create_draft",
      arguments: {
        id: MAILBOX_ID,
        to: [{ address: "jane@example.com", name: "Jane" }],
        subject: "Quick intro",
        text: "Hi Jane,",
        idempotency_key: "draft-intro-1",
      },
    });

    expect(result.isError).toBeFalsy();
    expect(captured).toEqual([
      {
        method: "POST",
        path: `/api/v1/mailboxes/${MAILBOX_ID}/inbox/drafts`,
        idempotencyKey: "draft-intro-1",
        body: {
          to: [{ address: "jane@example.com", name: "Jane" }],
          subject: "Quick intro",
          text: "Hi Jane,",
        },
      },
    ]);
    expect(result.structuredContent).toMatchObject({
      inbox_draft: { object: "inbox_draft", id: "eml_draft_1" },
    });
  });

  test("tells the agent it only saves a draft and cannot send", async () => {
    const client = await buildPair([]);
    const tool = (await client.listTools()).tools.find(
      (entry) => entry.name === "shipmail_create_draft",
    );

    expect(tool?.description).toContain("sends nothing");
    expect(tool?.description).toContain("Drafts");
    expect(tool?.annotations?.readOnlyHint).toBe(false);
    expect(tool?.annotations?.destructiveHint).toBe(false);
    expect(tool?.annotations?.openWorldHint).toBe(true);
  });

  test("requires a recipient and a body, and rejects threading fields", () => {
    const base = { id: MAILBOX_ID, to: ["jane@example.com"], text: "Hi" };
    expect(createInboxDraftInputSchema.safeParse(base).success).toBe(true);
    expect(createInboxDraftInputSchema.safeParse({ ...base, to: [] }).success).toBe(false);
    expect(
      createInboxDraftInputSchema.safeParse({ id: MAILBOX_ID, to: ["jane@example.com"] }).success,
    ).toBe(false);
    expect(
      createInboxDraftInputSchema.safeParse({ ...base, in_reply_to: "<a@example.com>" }).success,
    ).toBe(false);
    expect(
      createInboxDraftInputSchema.safeParse({
        ...base,
        to: Array.from({ length: 30 }, (_, index) => `to${index}@example.com`),
        bcc: Array.from({ length: 21 }, (_, index) => `bcc${index}@example.com`),
      }).success,
    ).toBe(false);
  });

  test("is granted by drafts:compose alone, not by drafts:write", () => {
    const capability = getMcpCapability("shipmail_create_draft");
    expect(capability?.requiredScope).toBe("drafts:compose");
    expect(capability?.permissionGroup).toBe("compose_drafts");
    expect(capability?.allowedRoles).toEqual(["owner", "member"]);
    expect(permissionGroupsToScopes(["compose_drafts"])).toEqual(["drafts:compose"]);

    expect(getAllowedMcpToolNames(["drafts:compose"], "stdio").has("shipmail_create_draft")).toBe(
      true,
    );
    expect(getAllowedMcpToolNames(["drafts:write"], "stdio").has("shipmail_create_draft")).toBe(
      false,
    );
    expect(getAllowedMcpToolNames(["drafts:compose"], "stdio").has("shipmail_send_message")).toBe(
      false,
    );
  });

  test("is not registered for a key without drafts:compose", async () => {
    const client = await buildPair([], getAllowedMcpToolNames(["drafts:write"], "stdio"));
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).not.toContain("shipmail_create_draft");
    expect(names).toContain("shipmail_create_inbox_reply_draft");
  });
});
