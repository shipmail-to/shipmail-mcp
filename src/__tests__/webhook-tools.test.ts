import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { ShipmailClient } from "shipmail";

import { webhookSchema } from "../schemas.js";
import { registerTools } from "../tools.js";

const WEBHOOK = webhookSchema.parse({
  object: "webhook",
  id: "whk_123",
  url: "https://example.com/hook",
  events: ["message.received"],
  active: true,
  description: null,
  mailbox_ids: null,
  domain_ids: null,
  has_authorization: true,
  has_standard_webhooks_secret: false,
  created_at: "2026-10-09T10:00:00Z",
  updated_at: "2026-10-09T10:00:00Z",
});

type ToolName = "shipmail_create_webhook" | "shipmail_update_webhook";

async function callWebhookTool(name: ToolName, args: Record<string, unknown>) {
  const bodies: unknown[] = [];
  const fetchImpl: typeof fetch = Object.assign(
    async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json(
        name === "shipmail_create_webhook" ? { ...WEBHOOK, secret: "whsec_abc" } : WEBHOOK,
      );
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
  registerTools(server, shipmail, new Set([name]));
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const result = await client.callTool({ name, arguments: args });
    return { result, bodies };
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

describe("webhook authorization tools", () => {
  test("create sends authorization and returns only has_authorization", async () => {
    const { result, bodies } = await callWebhookTool("shipmail_create_webhook", {
      url: "https://example.com/hook",
      events: ["message.received"],
      authorization: "Bearer key_123",
    });

    expect(result.isError).toBeFalsy();
    expect(bodies).toEqual([
      {
        url: "https://example.com/hook",
        events: ["message.received"],
        authorization: "Bearer key_123",
      },
    ]);
    expect(result.structuredContent).toMatchObject({ webhook: { has_authorization: true } });
    expect(JSON.stringify(result.structuredContent)).not.toContain("key_123");
  });

  test("update with only authorization null clears it", async () => {
    const { result, bodies } = await callWebhookTool("shipmail_update_webhook", {
      id: "whk_123",
      authorization: null,
    });

    expect(result.isError).toBeFalsy();
    expect(bodies).toEqual([{ authorization: null }]);
  });

  test("create and update pass a Standard Webhooks secret through and never return it", async () => {
    const created = await callWebhookTool("shipmail_create_webhook", {
      url: "https://example.com/hook",
      events: ["message.received"],
      standard_webhooks_secret: "whsec_receiver",
    });
    expect(created.result.isError).toBeFalsy();
    expect(created.bodies).toEqual([
      {
        url: "https://example.com/hook",
        events: ["message.received"],
        standard_webhooks_secret: "whsec_receiver",
      },
    ]);
    expect(JSON.stringify(created.result.structuredContent)).not.toContain("whsec_receiver");

    const cleared = await callWebhookTool("shipmail_update_webhook", {
      id: "whk_123",
      standard_webhooks_secret: null,
    });
    expect(cleared.result.isError).toBeFalsy();
    expect(cleared.bodies).toEqual([{ standard_webhooks_secret: null }]);
  });

  test("update without authorization leaves it out of the request", async () => {
    const { bodies } = await callWebhookTool("shipmail_update_webhook", {
      id: "whk_123",
      active: false,
    });

    expect(bodies).toEqual([{ active: false }]);
  });
});
