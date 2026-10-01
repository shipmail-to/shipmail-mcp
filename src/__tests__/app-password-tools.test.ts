import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { ShipmailClient } from "shipmail";

import { registerTools } from "../tools.js";

type CapturedRequest = {
  readonly url: URL;
  readonly method: string;
  readonly headers: Headers;
  readonly body: unknown;
};

function appPassword(extra: Record<string, unknown> = {}) {
  return {
    object: "mailbox_app_password",
    id: "appwd_0123456789abcdefghjkmnpq",
    mailbox_id: "mbx_0123456789abcdefghjkmnpq",
    name: "Desktop mail",
    state: "active",
    purpose: "operator_client",
    expires_at: "2026-10-01T00:00:00.000Z",
    allowed_cidrs: ["203.0.113.0/24"],
    last_used_at: null,
    created_at: "2026-07-15T00:00:00.000Z",
    revoked_at: null,
    ...extra,
  };
}

async function buildPair(captured: CapturedRequest[]) {
  const shipmail = new ShipmailClient({
    apiKey: "sm_live_test",
    baseUrl: "https://shipmail.to/api/v1",
    maxRetries: 0,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const request = {
        url: new URL(String(input)),
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      };
      captured.push(request);
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      if (request.method === "POST") {
        return Response.json(appPassword({ secret: "operator-secret-once" }), { status: 201 });
      }
      return Response.json({ object: "list", data: [appPassword()] });
    }) as typeof fetch,
  });
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, shipmail, undefined);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("mailbox app-password MCP tools", () => {
  test("lists, creates, and revokes app passwords", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);
    const mailboxId = "mbx_0123456789abcdefghjkmnpq";
    const appPasswordId = "appwd_0123456789abcdefghjkmnpq";
    const tools = await client.listTools();
    expect(
      tools.tools.find((tool) => tool.name === "shipmail_create_mailbox_app_password")?.annotations
        ?.idempotentHint,
    ).toBe(false);

    const listed = await client.callTool({
      name: "shipmail_list_mailbox_app_passwords",
      arguments: { id: mailboxId },
    });
    const created = await client.callTool({
      name: "shipmail_create_mailbox_app_password",
      arguments: {
        id: mailboxId,
        name: "Desktop mail",
        expires_at: "2026-10-01T00:00:00.000Z",
        allowed_cidrs: ["203.0.113.0/24"],
      },
    });
    const revoked = await client.callTool({
      name: "shipmail_revoke_mailbox_app_password",
      arguments: { id: mailboxId, app_password_id: appPasswordId },
    });

    expect(listed.isError).toBeFalsy();
    expect(created.isError).toBeFalsy();
    expect(revoked.isError).toBeFalsy();
    expect(captured.map((request) => `${request.method} ${request.url.pathname}`)).toEqual([
      `GET /api/v1/mailboxes/${mailboxId}/app-passwords`,
      `POST /api/v1/mailboxes/${mailboxId}/app-passwords`,
      `DELETE /api/v1/mailboxes/${mailboxId}/app-passwords/${appPasswordId}`,
    ]);
    expect(captured[1]?.headers.get("Idempotency-Key")).toBeNull();
    expect(captured[1]?.body).toEqual({
      name: "Desktop mail",
      expires_at: "2026-10-01T00:00:00.000Z",
      allowed_cidrs: ["203.0.113.0/24"],
    });
    expect(
      (created.structuredContent as { app_password?: { secret?: string } }).app_password?.secret,
    ).toBe("operator-secret-once");
  });
});
