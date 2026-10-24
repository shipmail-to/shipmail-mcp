import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { ShipmailClient } from "shipmail";

import {
  getAllowedMcpToolNames,
  getMcpCapability,
  permissionGroupsToScopes,
} from "../capabilities.js";
import {
  createInboxDraftInputSchema,
  sendInboxReplyDraftInputSchema,
  updateInboxReplyDraftInputSchema,
} from "../schemas.js";
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

const INBOX_DRAFT = {
  object: "inbox_draft",
  id: "eml_draft_1",
  mailbox_id: MAILBOX_ID,
  from: { address: "founder@example.com", name: null },
  to: [{ address: "jane@example.com", name: "Jane" }],
  cc: [],
  bcc: [],
  subject: "Quick intro",
  removed_formatting: [],
  created_at: "2026-09-24T12:00:00.000Z",
};

const REPLY_DRAFT = {
  object: "inbox_reply_draft",
  id: "drf_123",
  mailbox_id: MAILBOX_ID,
  thread_id: "thr_123",
  conversation_id: "thd_123",
  based_on_message_id: "msg_123",
  expected_version: 7,
  reply_mode: "reply",
  status: "draft",
  to: [{ address: "jane@example.com", name: "Jane" }],
  cc: [],
  subject: "Re: Quick intro",
  html: "<p>Thanks.</p>",
  text: "Thanks.",
  content_sha256: "a".repeat(64),
  sent_message_id: null,
  created_at: "2026-10-16T12:00:00.000Z",
  updated_at: "2026-10-16T12:01:00.000Z",
  sent_at: null,
};

function replyDraftResponse(method: string, path: string): Response {
  if (method === "DELETE") return new Response(null, { status: 204 });
  if (method === "PATCH") return Response.json({ ...REPLY_DRAFT, removed_formatting: ["table"] });
  if (path.endsWith("/drafts")) return Response.json({ object: "list", data: [REPLY_DRAFT] });
  return Response.json(REPLY_DRAFT);
}

const SENT_MESSAGE = {
  object: "message",
  id: "msg_sent",
  mailbox_id: MAILBOX_ID,
  thread_id: "thr_123",
  conversation_id: "thd_123",
  source_rfc_message_id: null,
  delivered_rfc_message_id: null,
  client_reference: null,
  metadata: {},
  headers: [],
  subject: "Re: Quick intro",
  from_address: "founder@example.com",
  to_addresses: [{ address: "jane@example.com" }],
  cc_addresses: null,
  bcc_addresses: null,
  attachments: null,
  source: "assistant",
  mode: "live",
  status: "sent",
  rule_disposition: null,
  scheduled_at: null,
  created_at: "2026-10-16T12:02:00.000Z",
  updated_at: "2026-10-16T12:02:00.000Z",
};

async function buildPair(
  captured: CapturedRequest[],
  allowedTools?: ReadonlySet<string>,
  respond: (method: string, path: string) => Response = () =>
    Response.json(INBOX_DRAFT, { status: 201 }),
) {
  const shipmail = new ShipmailClient({
    apiKey: "sm_live_test",
    baseUrl: "https://shipmail.to/api/v1",
    maxRetries: 0,
    fetch: stubFetch(async (input, init) => {
      const headers = new Headers(init?.headers);
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const method = init?.method ?? "GET";
      const path = new URL(String(input)).pathname;
      captured.push({ method, path, idempotencyKey: headers.get("idempotency-key"), body });
      return respond(method, path);
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

describe("reply draft tools", () => {
  const draftPath = `/api/v1/mailboxes/${MAILBOX_ID}/inbox/threads/thr_123/drafts`;

  test("list, read, update and delete reply drafts through the thread drafts endpoints", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured, undefined, replyDraftResponse);
    const ids = { id: MAILBOX_ID, thread_id: "thr_123" };

    const list = await client.callTool({
      name: "shipmail_list_inbox_reply_drafts",
      arguments: ids,
    });
    const read = await client.callTool({
      name: "shipmail_get_inbox_reply_draft",
      arguments: { ...ids, draft_id: "drf_123" },
    });
    const updated = await client.callTool({
      name: "shipmail_update_inbox_reply_draft",
      arguments: { ...ids, draft_id: "drf_123", html: "<p>Thanks.</p><table></table>" },
    });
    const deleted = await client.callTool({
      name: "shipmail_delete_inbox_reply_draft",
      arguments: { ...ids, draft_id: "drf_123", idempotency_key: "delete-drf-123" },
    });

    for (const result of [list, read, updated, deleted]) expect(result.isError).toBeFalsy();
    expect(captured.map((request) => `${request.method} ${request.path}`)).toEqual([
      `GET ${draftPath}`,
      `GET ${draftPath}/drf_123`,
      `PATCH ${draftPath}/drf_123`,
      `DELETE ${draftPath}/drf_123`,
    ]);
    expect(captured[2]?.body).toEqual({ html: "<p>Thanks.</p><table></table>" });
    expect(list.structuredContent).toMatchObject({
      inbox_reply_drafts: { object: "list", data: [{ id: "drf_123" }] },
    });
    expect(read.structuredContent).toMatchObject({
      inbox_reply_draft: { id: "drf_123", html: "<p>Thanks.</p>" },
    });
    expect(updated.structuredContent).toMatchObject({
      inbox_reply_draft: { id: "drf_123", removed_formatting: ["table"] },
    });
    expect(deleted.structuredContent).toMatchObject({ result: { ok: true, id: "drf_123" } });
  });

  test("describe the HTML rules, removed_formatting and where expected_version comes from", async () => {
    const tools = (await (await buildPair([])).listTools()).tools;
    const describe = (name: string) => tools.find((tool) => tool.name === name)?.description ?? "";

    for (const name of [
      "shipmail_create_draft",
      "shipmail_create_inbox_reply_draft",
      "shipmail_update_inbox_reply_draft",
    ]) {
      expect(describe(name)).toContain("blockquote");
      expect(describe(name)).toContain("removed_formatting");
      expect(describe(name)).toContain("<p><br></p>");
    }
    expect(describe("shipmail_create_inbox_reply_draft")).toContain(
      "expected_version is the version field of the inbox thread read",
    );
    expect(describe("shipmail_get_mailbox_inbox_thread")).toContain("expected_version");
  });

  test("mark delete as destructive and keep every reply draft tool on drafts:write", () => {
    expect(getMcpCapability("shipmail_delete_inbox_reply_draft")?.annotations.destructiveHint).toBe(
      true,
    );
    expect(getMcpCapability("shipmail_update_inbox_reply_draft")?.annotations.destructiveHint).toBe(
      false,
    );
    const allowed = getAllowedMcpToolNames(["drafts:write"], "stdio");
    for (const name of [
      "shipmail_list_inbox_reply_drafts",
      "shipmail_get_inbox_reply_draft",
      "shipmail_update_inbox_reply_draft",
      "shipmail_delete_inbox_reply_draft",
    ] as const) {
      expect(getMcpCapability(name)?.requiredScope).toBe("drafts:write");
      expect(allowed.has(name)).toBe(true);
    }
  });

  test("require a body to update a reply draft", () => {
    const base = { id: MAILBOX_ID, thread_id: "thr_123", draft_id: "drf_123" };
    expect(updateInboxReplyDraftInputSchema.safeParse({ ...base, text: "Hi" }).success).toBe(true);
    expect(updateInboxReplyDraftInputSchema.safeParse(base).success).toBe(false);
    expect(
      updateInboxReplyDraftInputSchema.safeParse({ ...base, text: "Hi", to: ["a@example.com"] })
        .success,
    ).toBe(false);
  });

  test("sends the approved content hash to the reply draft endpoint", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured, undefined, () =>
      Response.json({
        object: "inbox_reply_draft_send",
        draft_id: "drf_123",
        status: "sent",
        message: SENT_MESSAGE,
      }),
    );

    const result = await client.callTool({
      name: "shipmail_send_inbox_reply_draft",
      arguments: {
        id: MAILBOX_ID,
        thread_id: "thr_123",
        draft_id: "drf_123",
        expected_content_sha256: "b".repeat(64),
        idempotency_key: "send-drf-123",
      },
    });

    expect(result.isError).toBeFalsy();
    expect(captured).toEqual([
      {
        method: "POST",
        path: `/api/v1/mailboxes/${MAILBOX_ID}/inbox/threads/thr_123/drafts/drf_123/send`,
        idempotencyKey: "send-drf-123",
        body: { expected_content_sha256: "b".repeat(64) },
      },
    ]);
    expect(
      sendInboxReplyDraftInputSchema.safeParse({
        id: MAILBOX_ID,
        thread_id: "thr_123",
        draft_id: "drf_123",
        expected_content_sha256: "B".repeat(64),
      }).success,
    ).toBe(false);
  });
});
