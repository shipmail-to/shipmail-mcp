import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, mock, test } from "bun:test";
import type { ShipmailClient } from "shipmail";

import { registerTools } from "../tools.js";

const MAILBOX = {
  object: "mailbox" as const,
  id: "mbx_123",
  domain_id: "dom_123",
  address: "support@example.test",
  display_name: "Support",
  suspended_at: null,
  suspension_reasons: [],
  auto_reply: {
    enabled: false,
    subject: null,
    body: null,
    from_date: null,
    to_date: null,
  },
  agent_security_hold: true,
  created_at: "2026-10-23T09:00:00.000Z",
  updated_at: "2026-10-23T09:00:00.000Z",
};

const SECURITY_REVIEW = {
  object: "inbox_message_security_review" as const,
  mailbox_id: "mbx_123",
  message_id: "eml_123",
  security: {
    status: "flagged" as const,
    risk_codes: ["instruction_override" as const],
    scanner: "pattern_v1" as const,
    content_sha256: "a".repeat(64),
    review: {
      decision: "released" as const,
      released_at: "2026-10-23T10:00:00.000Z",
      released_by: "api_key" as const,
    },
  },
};

async function callTool(name: string, args: Record<string, unknown>, shipmail: ShipmailClient) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, shipmail, new Set([name]));
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

describe("security review MCP tools", () => {
  test("updates the API-agent hold setting", async () => {
    const update = mock(async () => MAILBOX);
    const shipmail = { mailboxes: { update } } as unknown as ShipmailClient;
    const result = await callTool(
      "shipmail_update_mailbox",
      { id: "mbx_123", agent_security_hold: true },
      shipmail,
    );

    expect(result.isError).toBeFalsy();
    expect(update).toHaveBeenCalledWith(
      "mbx_123",
      { agent_security_hold: true },
      { idempotencyKey: expect.stringMatching(/^mcp_[0-9a-f]{32}$/) },
    );
    expect(result.structuredContent).toEqual({ mailbox: MAILBOX });
  });

  test("releases only the caller-reviewed content snapshot", async () => {
    const releaseInboxMessageSecurity = mock(async () => SECURITY_REVIEW);
    const shipmail = {
      mailboxes: { releaseInboxMessageSecurity },
    } as unknown as ShipmailClient;
    const result = await callTool(
      "shipmail_release_mailbox_inbox_message_security",
      {
        id: "mbx_123",
        message_id: "eml_123",
        decision: "release",
        reason: "Known invoice workflow",
        expected_content_sha256: "a".repeat(64),
      },
      shipmail,
    );

    expect(result.isError).toBeFalsy();
    expect(releaseInboxMessageSecurity).toHaveBeenCalledWith("mbx_123", "eml_123", {
      decision: "release",
      reason: "Known invoice workflow",
      expected_content_sha256: "a".repeat(64),
    });
    expect(result.structuredContent).toEqual({ security_review: SECURITY_REVIEW });
  });
});
