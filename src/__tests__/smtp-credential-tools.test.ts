import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { ShipmailClient } from "shipmail";

import { MCP_CAPABILITIES } from "../capabilities.js";
import { createdSmtpCredentialOutputSchema } from "../schemas.js";
import { registerTools } from "../tools.js";

type CapturedRequest = {
  readonly url: URL;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string | null;
};

const credential = {
  object: "smtp_credential",
  id: "smtpc_0123456789abcdefghjkmnpq",
  from: "notifications@notify.example.com",
  name: "Supabase Auth",
  username: "smtp-smtpc_0123456789abcdefghjkmnpq@txsmtp.shipmail.to",
  host: "mx1.shipmail.to",
  ports: [
    { port: 465, security: "tls" },
    { port: 587, security: "starttls" },
  ],
  last_used_at: null,
  created_at: "2026-11-03T00:00:00.000Z",
};

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
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      if (request.method === "POST") {
        return Response.json({ ...credential, password: "shown-once" }, { status: 201 });
      }
      return Response.json({ object: "list", data: [credential] });
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

describe("SMTP credential MCP tools", () => {
  test("lists, creates, and revokes SMTP credentials", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);

    const listed = await client.callTool({
      name: "shipmail_list_smtp_credentials",
      arguments: { from: "Notifications@notify.example.com" },
    });
    const created = await client.callTool({
      name: "shipmail_create_smtp_credential",
      arguments: { from: "notifications@notify.example.com", name: "Supabase Auth" },
    });
    const revoked = await client.callTool({
      name: "shipmail_revoke_smtp_credential",
      arguments: { id: credential.id },
    });

    expect(listed.isError).toBeFalsy();
    expect(created.isError).toBeFalsy();
    expect(revoked.isError).toBeFalsy();
    expect(captured.map((request) => `${request.method} ${request.url.pathname}`)).toEqual([
      "GET /api/v1/smtp-credentials",
      "POST /api/v1/smtp-credentials",
      `DELETE /api/v1/smtp-credentials/${credential.id}`,
    ]);
    expect(captured[0]?.url.searchParams.get("from")).toBe("notifications@notify.example.com");
    expect(captured[1]?.headers.get("Idempotency-Key")).toBeNull();
    expect(JSON.parse(captured[1]?.body ?? "null")).toEqual({
      from: "notifications@notify.example.com",
      name: "Supabase Auth",
    });
    const output = createdSmtpCredentialOutputSchema.parse(created.structuredContent);
    expect(output.smtp_credential.password).toBe("shown-once");
  });

  test("declares credential capabilities with the mailbox_credentials scopes", () => {
    const rows = MCP_CAPABILITIES.filter((capability) =>
      capability.toolName.includes("smtp_credential"),
    ).map((capability) => ({
      tool: capability.toolName,
      scope: capability.requiredScope,
      group: capability.permissionGroup,
      duration: capability.duration,
      idempotency: capability.idempotency,
    }));

    expect(rows).toEqual([
      {
        tool: "shipmail_list_smtp_credentials",
        scope: "mailbox_credentials:read",
        group: "credentials",
        duration: "credential",
        idempotency: "none",
      },
      {
        tool: "shipmail_create_smtp_credential",
        scope: "mailbox_credentials:write",
        group: "credentials",
        duration: "credential",
        idempotency: "forbidden",
      },
      {
        tool: "shipmail_revoke_smtp_credential",
        scope: "mailbox_credentials:write",
        group: "credentials",
        duration: "credential",
        idempotency: "resource_key",
      },
    ]);
  });
});
