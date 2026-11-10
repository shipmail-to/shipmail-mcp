import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { ShipmailClient } from "shipmail";

import { registerTools } from "../tools.js";

async function callRaw(respond: () => Response) {
  const paths: string[] = [];
  const fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      paths.push(new URL(String(input)).pathname);
      return respond();
    },
    { preconnect() {} },
  );
  const shipmail = new ShipmailClient({
    apiKey: "sk_test",
    baseUrl: "https://shipmail.to/api/v1",
    maxRetries: 0,
    fetch,
  });
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, shipmail, new Set(["shipmail_read_mailbox_inbox_message_raw"]));
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.callTool({
    name: "shipmail_read_mailbox_inbox_message_raw",
    arguments: { id: "mbx_123", message_id: "eml_123" },
  });
  await Promise.all([client.close(), server.close()]);
  return { result, paths };
}

describe("shipmail_read_mailbox_inbox_message_raw", () => {
  test("returns the stored MIME source as text", async () => {
    const raw = "From: jane@example.com\r\nSubject: Hi\r\n\r\nHello";
    const { result, paths } = await callRaw(() => new Response(raw));

    expect(result.isError).toBeFalsy();
    expect(paths).toEqual(["/api/v1/mailboxes/mbx_123/inbox/messages/eml_123/raw"]);
    expect(result.structuredContent).toEqual({
      raw_message: {
        object: "inbox_message_raw",
        mailbox_id: "mbx_123",
        message_id: "eml_123",
        size: Buffer.byteLength(raw),
        text: raw,
      },
    });
  });

  test("refuses a message over the MCP read limit", async () => {
    const { result } = await callRaw(() => new Response(new Uint8Array(3 * 1024 * 1024 + 1)));

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("3 MB");
  });
});
