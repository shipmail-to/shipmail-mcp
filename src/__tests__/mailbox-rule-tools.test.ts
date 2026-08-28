import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import {
  ConflictError,
  type MailboxRule,
  type MailboxRules,
  ShipmailClient,
  ValidationError,
} from "shipmail";

import {
  assertCustomFoldersBelongToMailbox,
  assertExpectedPosition,
  findRuleOrThrow,
  insertRuleAt,
  replaceRuleAt,
  toMcpMailboxRule,
  withoutPositions,
  withPositions,
} from "../mailbox-rule-tools.js";
import { registerTools } from "../tools.js";

const RULE_A: MailboxRule = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "Invoices",
  enabled: true,
  position: 0,
  match_mode: "all",
  stop: false,
  conditions: [{ type: "subject_contains", value: "invoice" }],
  actions: [{ type: "move", target: { kind: "custom", folder_id: "fld_billing" } }],
};

const RULE_B: MailboxRule = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  name: "Newsletters",
  enabled: false,
  position: 1,
  match_mode: "any",
  stop: true,
  conditions: [{ type: "list_unsubscribe_exists" }],
  actions: [{ type: "move", target: { kind: "system", role: "archive" } }],
};

function rulesResponse(rules: readonly MailboxRule[]): MailboxRules {
  return {
    object: "mailbox_rules",
    mailbox_id: "mbx_123",
    address: "hello@example.com",
    rules,
    folders: [
      { id: "fld_billing", name: "Billing", parent_id: null, role: null, kind: "custom" },
      { id: "fld_other_mailbox", name: "Other", parent_id: null, role: null, kind: "custom" },
    ],
  };
}

describe("mailbox rule helpers", () => {
  test("rejects custom folders that are not on the mailbox", () => {
    expect(() =>
      assertCustomFoldersBelongToMailbox(rulesResponse([]).folders, [
        { type: "move", target: { kind: "custom", folder_id: "fld_missing" } },
      ]),
    ).toThrow(ValidationError);
  });

  test("accepts custom and system folder targets for the mailbox", () => {
    expect(() =>
      assertCustomFoldersBelongToMailbox(rulesResponse([]).folders, [
        { type: "move", target: { kind: "custom", folder_id: "fld_billing" } },
        { type: "move", target: { kind: "system", role: "trash" } },
        { type: "mark_read" },
        { type: "star" },
      ]),
    ).not.toThrow();
  });

  test("preserves stable IDs and renumbers positions", () => {
    const merged = withPositions(
      insertRuleAt(
        withoutPositions([RULE_A, RULE_B]),
        {
          id: "550e8400-e29b-41d4-a716-446655440099",
          name: "VIP",
          enabled: true,
          match_mode: "all",
          stop: false,
          conditions: [{ type: "from_is", value: "vip@example.com" }],
          actions: [{ type: "star" }],
        },
        1,
      ),
    );
    expect(merged.map((rule) => rule.id)).toEqual([
      RULE_A.id,
      "550e8400-e29b-41d4-a716-446655440099",
      RULE_B.id,
    ]);
    expect(merged.map((rule) => rule.position)).toEqual([0, 1, 2]);
  });

  test("replaceRuleAt keeps the rule ID while changing order", () => {
    const remaining = withoutPositions([RULE_B]);
    const merged = withPositions(
      replaceRuleAt(
        remaining,
        {
          id: RULE_A.id,
          name: "Invoices renamed",
          enabled: false,
          match_mode: "all",
          stop: false,
          conditions: RULE_A.conditions,
          actions: RULE_A.actions,
        },
        1,
      ),
    );
    expect(merged[1]?.id).toBe(RULE_A.id);
    expect(merged[1]?.name).toBe("Invoices renamed");
    expect(merged[1]?.enabled).toBe(false);
    expect(merged[1]?.position).toBe(1);
  });

  test("expected_position conflict and not-found paths", () => {
    expect(() => assertExpectedPosition(RULE_A, 1)).toThrow(ConflictError);
    expect(() => findRuleOrThrow([RULE_A], RULE_B.id)).toThrow(/was not found/);
    expect(toMcpMailboxRule("mbx_123", RULE_A).mailbox_id).toBe("mbx_123");
  });
});

async function connectedRuleClient(handler: (input: Request) => Promise<Response> | Response) {
  const shipmail = new ShipmailClient({
    apiKey: "sm_test",
    baseUrl: "https://shipmail.to/api/v1",
    maxRetries: 0,
    fetch: Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(String(input), init);
        return handler(request);
      },
      { preconnect(_url: string | URL): void {} },
    ),
  });
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(
    server,
    shipmail,
    new Set([
      "shipmail_list_mailbox_rules",
      "shipmail_get_mailbox_rule",
      "shipmail_create_mailbox_rule",
      "shipmail_update_mailbox_rule",
      "shipmail_delete_mailbox_rule",
    ]),
  );
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, server };
}

describe("mailbox rule MCP tools", () => {
  test("create → list → get → update → delete lifecycle with enable and priority", async () => {
    let state = rulesResponse([]);
    const puts: unknown[] = [];

    const { client, server } = await connectedRuleClient(async (request) => {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname.endsWith("/rules")) {
        return Response.json(state);
      }
      if (request.method === "PUT" && url.pathname.endsWith("/rules")) {
        const body = (await request.json()) as { rules: MailboxRule[] };
        puts.push(body);
        state = rulesResponse(body.rules);
        return Response.json(state);
      }
      return new Response("not found", { status: 404 });
    });

    try {
      const created = await client.callTool({
        name: "shipmail_create_mailbox_rule",
        arguments: {
          id: "mbx_123",
          name: "Billing",
          enabled: true,
          position: 0,
          conditions: [{ type: "from_contains", value: "stripe.com" }],
          actions: [{ type: "move", target: { kind: "custom", folder_id: "fld_billing" } }],
          idempotency_key: "mcp_create_1",
        },
      });
      expect(created.isError ?? false).toBe(false);
      const createdRule = (
        created.structuredContent as { rule: MailboxRule & { mailbox_id: string } }
      ).rule;
      expect(createdRule.mailbox_id).toBe("mbx_123");
      expect(createdRule.enabled).toBe(true);
      expect(createdRule.position).toBe(0);

      await client.callTool({
        name: "shipmail_create_mailbox_rule",
        arguments: {
          id: "mbx_123",
          name: "Archive newsletters",
          enabled: false,
          conditions: [{ type: "list_unsubscribe_exists" }],
          actions: [{ type: "move", target: { kind: "system", role: "archive" } }],
        },
      });

      const listed = await client.callTool({
        name: "shipmail_list_mailbox_rules",
        arguments: { id: "mbx_123" },
      });
      const listedRules = (listed.structuredContent as { rules: MailboxRules }).rules.rules;
      expect(listedRules).toHaveLength(2);
      expect(listedRules[1]?.enabled).toBe(false);

      const got = await client.callTool({
        name: "shipmail_get_mailbox_rule",
        arguments: { id: "mbx_123", rule_id: createdRule.id },
      });
      expect((got.structuredContent as { rule: { id: string } }).rule.id).toBe(createdRule.id);

      const updated = await client.callTool({
        name: "shipmail_update_mailbox_rule",
        arguments: {
          id: "mbx_123",
          rule_id: createdRule.id,
          enabled: false,
          position: 1,
          expected_position: 0,
          idempotency_key: "mcp_update_1",
        },
      });
      const updatedRule = (updated.structuredContent as { rule: MailboxRule }).rule;
      expect(updatedRule.enabled).toBe(false);
      expect(updatedRule.position).toBe(1);
      expect(updatedRule.id).toBe(createdRule.id);

      const deleted = await client.callTool({
        name: "shipmail_delete_mailbox_rule",
        arguments: { id: "mbx_123", rule_id: createdRule.id, expected_position: 1 },
      });
      expect((deleted.structuredContent as { result: { ok: boolean } }).result.ok).toBe(true);
      expect(state.rules.map((rule) => rule.id)).not.toContain(createdRule.id);
      expect(puts.length).toBeGreaterThanOrEqual(3);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  test("rejects cross-mailbox custom folders and stale expected_position", async () => {
    const state = rulesResponse([RULE_A]);
    const { client, server } = await connectedRuleClient(async (request) => {
      if (request.method === "GET") return Response.json(state);
      return Response.json(state);
    });

    try {
      const badFolder = await client.callTool({
        name: "shipmail_create_mailbox_rule",
        arguments: {
          id: "mbx_123",
          name: "Bad folder",
          conditions: [{ type: "has_attachment" }],
          actions: [{ type: "move", target: { kind: "custom", folder_id: "fld_from_elsewhere" } }],
        },
      });
      expect(badFolder.isError).toBe(true);
      expect(JSON.stringify(badFolder.content)).toContain("not available on this mailbox");

      const stale = await client.callTool({
        name: "shipmail_update_mailbox_rule",
        arguments: {
          id: "mbx_123",
          rule_id: RULE_A.id,
          enabled: false,
          expected_position: 9,
        },
      });
      expect(stale.isError).toBe(true);
      expect(JSON.stringify(stale.content)).toContain("changed");
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  test("rejects missing rules and unauthorized mailbox responses", async () => {
    const { client, server } = await connectedRuleClient(async (request) => {
      const url = new URL(request.url);
      if (url.pathname.includes("mbx_missing")) {
        return Response.json(
          { error: { type: "not_found", message: "Mailbox not found." } },
          { status: 404 },
        );
      }
      return Response.json(rulesResponse([RULE_A]));
    });

    try {
      const missingMailbox = await client.callTool({
        name: "shipmail_list_mailbox_rules",
        arguments: { id: "mbx_missing" },
      });
      expect(missingMailbox.isError).toBe(true);

      const missingRule = await client.callTool({
        name: "shipmail_get_mailbox_rule",
        arguments: { id: "mbx_123", rule_id: RULE_B.id },
      });
      expect(missingRule.isError).toBe(true);
      expect(JSON.stringify(missingRule.content)).toContain("was not found");

      const malformed = await client.callTool({
        name: "shipmail_get_mailbox_rule",
        arguments: { id: "mbx_123", rule_id: "not-a-uuid" },
      });
      expect(malformed.isError).toBe(true);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  test("advertises organization_id on rule tools for multi-org connections", async () => {
    const shipmail = new ShipmailClient({
      apiKey: "sm_test",
      baseUrl: "https://shipmail.to/api/v1",
      maxRetries: 0,
    });
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(
      server,
      shipmail,
      new Set([
        "shipmail_list_mailbox_rules",
        "shipmail_get_mailbox_rule",
        "shipmail_create_mailbox_rule",
        "shipmail_update_mailbox_rule",
        "shipmail_delete_mailbox_rule",
      ]),
      [
        { id: "org_a", name: "A" },
        { id: "org_b", name: "B" },
      ],
    );
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const { tools } = await client.listTools();
      for (const name of [
        "shipmail_list_mailbox_rules",
        "shipmail_get_mailbox_rule",
        "shipmail_create_mailbox_rule",
        "shipmail_update_mailbox_rule",
        "shipmail_delete_mailbox_rule",
      ]) {
        const tool = tools.find((entry) => entry.name === name);
        expect(tool?.inputSchema?.properties?.["organization_id"]).toBeDefined();
      }
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});
