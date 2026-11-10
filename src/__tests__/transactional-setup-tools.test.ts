import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { ShipmailClient } from "shipmail";

import { MCP_CAPABILITIES } from "../capabilities.js";
import { transactionalDomainOutputSchema, transactionalSenderOutputSchema } from "../schemas.js";
import { registerTools } from "../tools.js";

type CapturedRequest = {
  readonly url: URL;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string | null;
};

const domain = {
  object: "transactional_domain",
  id: "txdom_0123456789abcdefghjkmnpq",
  name: "mail.example.com",
  root_domain: "example.com",
  status: "pending",
  mail_from_domain: "bounce.mail.example.com",
  dns_records: [
    {
      key: "dkim",
      type: "TXT",
      host: "shipmail._domainkey.mail.example.com",
      value: "v=DKIM1; k=rsa; p=abc",
      priority: null,
      ttl: 300,
      description: "Signs your transactional email so inboxes trust it.",
      status: "pending",
    },
  ],
  verified_at: null,
  created_at: "2026-11-08T09:00:00.000Z",
};

const sender = {
  object: "transactional_sender",
  id: "txbind_0123456789abcdefghjkmnpq",
  from: "hello@mail.example.com",
  display_name: "Acme",
  domain_id: domain.id,
  mailbox_id: "550e8400-e29b-41d4-a716-446655440000",
  reply_to: "support@example.com",
  state: "active",
  refuse_disposable: false,
  smtp_enabled: false,
  created_at: "2026-11-08T09:00:00.000Z",
};

function respond(request: CapturedRequest): Response {
  if (request.method === "DELETE") return new Response(null, { status: 204 });
  const isSender = request.url.pathname.includes("/transactional-senders");
  const item = isSender ? sender : domain;
  const isCollection =
    request.url.pathname.endsWith("/transactional-senders") ||
    request.url.pathname.endsWith("/transactional-domains");
  if (request.method === "POST" && isCollection) return Response.json(item, { status: 201 });
  if (request.method === "GET" && isCollection) {
    return Response.json({ object: "list", data: [item] });
  }
  return Response.json(item);
}

async function buildPair(captured: CapturedRequest[]) {
  const fetchFn: typeof fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const request: CapturedRequest = {
        url: new URL(String(input)),
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : null,
      };
      captured.push(request);
      return respond(request);
    },
    { preconnect: globalThis.fetch.preconnect },
  );
  const shipmail = new ShipmailClient({
    apiKey: "sm_live_test",
    baseUrl: "https://shipmail.to/api/v1",
    maxRetries: 0,
    fetch: fetchFn,
  });
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, shipmail, undefined);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("transactional setup MCP tools", () => {
  test("lists, creates, gets, verifies, and deletes transactional domains", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);

    const results = [
      await client.callTool({ name: "shipmail_list_transactional_domains", arguments: {} }),
      await client.callTool({
        name: "shipmail_create_transactional_domain",
        arguments: { root_domain: "example.com", subdomain: "Mail" },
      }),
      await client.callTool({
        name: "shipmail_get_transactional_domain",
        arguments: { id: domain.id },
      }),
      await client.callTool({
        name: "shipmail_verify_transactional_domain",
        arguments: { id: domain.id },
      }),
      await client.callTool({
        name: "shipmail_delete_transactional_domain",
        arguments: { id: domain.id },
      }),
    ];

    for (const result of results) expect(result.isError).toBeFalsy();
    expect(captured.map((request) => `${request.method} ${request.url.pathname}`)).toEqual([
      "GET /api/v1/transactional-domains",
      "POST /api/v1/transactional-domains",
      `GET /api/v1/transactional-domains/${domain.id}`,
      `POST /api/v1/transactional-domains/${domain.id}/verify`,
      `DELETE /api/v1/transactional-domains/${domain.id}`,
    ]);
    expect(JSON.parse(captured[1]?.body ?? "null")).toEqual({
      root_domain: "example.com",
      subdomain: "mail",
    });
    expect(captured[1]?.headers.get("Idempotency-Key")).toStartWith("mcp_");
    const output = transactionalDomainOutputSchema.parse(results[1]?.structuredContent);
    expect(output.transactional_domain.dns_records[0]?.key).toBe("dkim");
  });

  test("lists, creates, gets, and updates transactional senders", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);

    const results = [
      await client.callTool({
        name: "shipmail_list_transactional_senders",
        arguments: { domain_id: domain.id },
      }),
      await client.callTool({
        name: "shipmail_create_transactional_sender",
        arguments: {
          domain_id: domain.id,
          mailbox_id: sender.mailbox_id,
          local_part: "hello",
          display_name: "Acme",
        },
      }),
      await client.callTool({
        name: "shipmail_get_transactional_sender",
        arguments: { id: sender.id },
      }),
      await client.callTool({
        name: "shipmail_update_transactional_sender",
        arguments: { id: sender.id, state: "disabled" },
      }),
    ];

    for (const result of results) expect(result.isError).toBeFalsy();
    expect(captured.map((request) => `${request.method} ${request.url.pathname}`)).toEqual([
      "GET /api/v1/transactional-senders",
      "POST /api/v1/transactional-senders",
      `GET /api/v1/transactional-senders/${sender.id}`,
      `PATCH /api/v1/transactional-senders/${sender.id}`,
    ]);
    expect(captured[0]?.url.searchParams.get("domain_id")).toBe(domain.id);
    expect(JSON.parse(captured[1]?.body ?? "null")).toEqual({
      domain_id: domain.id,
      mailbox_id: sender.mailbox_id,
      local_part: "hello",
      display_name: "Acme",
    });
    expect(JSON.parse(captured[3]?.body ?? "null")).toEqual({ state: "disabled" });
    const output = transactionalSenderOutputSchema.parse(results[1]?.structuredContent);
    expect(output.transactional_sender.from).toBe("hello@mail.example.com");
  });

  test("refuses an update with no change and a malformed ID", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);

    const empty = await client.callTool({
      name: "shipmail_update_transactional_sender",
      arguments: { id: sender.id },
    });
    const malformed = await client.callTool({
      name: "shipmail_get_transactional_domain",
      arguments: { id: "dom_123" },
    });

    expect(empty.isError).toBe(true);
    expect(malformed.isError).toBe(true);
    expect(captured).toEqual([]);
  });

  test("declares domains under domain_admin and senders under mailbox_admin", () => {
    const rows = MCP_CAPABILITIES.filter((capability) =>
      capability.toolName.includes("_transactional_"),
    ).map((capability) => ({
      tool: capability.toolName,
      scope: capability.requiredScope,
      group: capability.permissionGroup,
      effect: capability.effect,
    }));

    expect(rows).toEqual([
      {
        tool: "shipmail_list_transactional_domains",
        scope: "domains:read",
        group: "domain_admin",
        effect: "read",
      },
      {
        tool: "shipmail_create_transactional_domain",
        scope: "domains:write",
        group: "domain_admin",
        effect: "local_write",
      },
      {
        tool: "shipmail_get_transactional_domain",
        scope: "domains:read",
        group: "domain_admin",
        effect: "read",
      },
      {
        tool: "shipmail_verify_transactional_domain",
        scope: "domains:write",
        group: "domain_admin",
        effect: "local_write",
      },
      {
        tool: "shipmail_delete_transactional_domain",
        scope: "domains:write",
        group: "domain_admin",
        effect: "destructive",
      },
      {
        tool: "shipmail_list_transactional_senders",
        scope: "mailboxes:read",
        group: "mailbox_admin",
        effect: "read",
      },
      {
        tool: "shipmail_create_transactional_sender",
        scope: "mailboxes:write",
        group: "mailbox_admin",
        effect: "local_write",
      },
      {
        tool: "shipmail_get_transactional_sender",
        scope: "mailboxes:read",
        group: "mailbox_admin",
        effect: "read",
      },
      {
        tool: "shipmail_update_transactional_sender",
        scope: "mailboxes:write",
        group: "mailbox_admin",
        effect: "local_write",
      },
    ]);
  });
});
