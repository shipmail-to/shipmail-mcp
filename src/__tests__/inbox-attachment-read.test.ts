import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { ShipmailClient } from "shipmail";

import { registerTools } from "../tools.js";

type TestFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function createPair(fetchRequest: TestFetch): {
  readonly server: McpServer;
  readonly client: Client;
} {
  const fetch = Object.assign(fetchRequest, { preconnect() {} });
  const shipmail = new ShipmailClient({
    apiKey: "sk_test",
    baseUrl: "https://shipmail.to/api/v1",
    maxRetries: 0,
    fetch,
  });
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, shipmail, new Set(["shipmail_read_mailbox_inbox_attachment"]));
  return { server, client: new Client({ name: "test-client", version: "0.0.0" }) };
}

async function connect(server: McpServer, client: Client): Promise<void> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
}

function inboxMessage(contentType = "application/pdf", attachmentSize = 4) {
  return {
    object: "inbox_message_full",
    id: "eml_123",
    thread_id: "thr_123",
    mailbox_id: "mbx_123",
    address: "hello@example.com",
    folder_ids: ["inbox"],
    keywords: {},
    from: [{ name: "Sender", email: "sender@example.com" }],
    to: [{ name: null, email: "hello@example.com" }],
    subject: "Invoice",
    received_at: "2026-08-31T12:00:00.000Z",
    preview: "Attached",
    has_attachment: true,
    size: 250,
    authentication_results: null,
    cc: null,
    reply_to: null,
    message_id: ["invoice@example.com"],
    in_reply_to: null,
    references: null,
    body_values: {},
    text_body: [],
    html_body: [],
    attachments: [
      {
        part_id: "part_1",
        blob_id: "blob/123",
        name: "invoice.pdf",
        content_type: contentType,
        size: attachmentSize,
        download_path: "/mailboxes/mbx_123/inbox/attachments?blob_id=blob%2F123&name=invoice.pdf",
      },
    ],
  };
}

describe("read inbox attachment", () => {
  test("returns server-resolved attachment bytes as an embedded MCP resource", async () => {
    let requestNumber = 0;
    const { server, client } = createPair(async (input, init) => {
      requestNumber += 1;
      const url = new URL(String(input));
      expect(init?.method).toBe("GET");

      if (requestNumber === 1) {
        expect(url.pathname).toBe("/api/v1/mailboxes/mbx_123/inbox/messages/eml_123");
        return Response.json(inboxMessage());
      }

      expect(url.pathname).toBe("/api/v1/mailboxes/mbx_123/inbox/attachments");
      expect(url.searchParams.get("blob_id")).toBe("blob/123");
      expect(url.searchParams.get("name")).toBe("invoice.pdf");
      return new Response(new Uint8Array([1, 2, 3, 4]));
    });
    await connect(server, client);

    const result = await client.callTool({
      name: "shipmail_read_mailbox_inbox_attachment",
      arguments: { id: "mbx_123", message_id: "eml_123", part_id: "part_1" },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      attachment: {
        object: "inbox_attachment_content",
        mailbox_id: "mbx_123",
        message_id: "eml_123",
        part_id: "part_1",
        blob_id: "blob/123",
        name: "invoice.pdf",
        content_type: "application/pdf",
        size: 4,
      },
    });
    const embedded = result.content.find((content) => content.type === "resource");
    expect(embedded?.type).toBe("resource");
    if (embedded?.type !== "resource") throw new Error("Expected embedded attachment resource.");
    expect(embedded.resource).toEqual({
      uri: "shipmail://mailboxes/mbx_123/inbox/messages/eml_123/attachments/part_1",
      mimeType: "application/pdf",
      blob: "AQIDBA==",
    });
    expect(requestNumber).toBe(2);

    await Promise.all([client.close(), server.close()]);
  });

  test("rejects a part that is not attached to the selected message", async () => {
    let requestNumber = 0;
    const { server, client } = createPair(async () => {
      requestNumber += 1;
      return Response.json(inboxMessage());
    });
    await connect(server, client);

    const result = await client.callTool({
      name: "shipmail_read_mailbox_inbox_attachment",
      arguments: { id: "mbx_123", message_id: "eml_123", part_id: "part_missing" },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Attachment part part_missing was not found"),
    });
    expect(requestNumber).toBe(1);

    await Promise.all([client.close(), server.close()]);
  });

  test("falls back to a safe media type when attachment metadata is malformed", async () => {
    let requestNumber = 0;
    const { server, client } = createPair(async () => {
      requestNumber += 1;
      return requestNumber === 1
        ? Response.json(inboxMessage("text/html\r\nX-Injected: yes"))
        : new Response(new Uint8Array([60, 112, 62, 120]));
    });
    await connect(server, client);

    const result = await client.callTool({
      name: "shipmail_read_mailbox_inbox_attachment",
      arguments: { id: "mbx_123", message_id: "eml_123", part_id: "part_1" },
    });

    const embedded = result.content.find((content) => content.type === "resource");
    if (embedded?.type !== "resource") throw new Error("Expected embedded attachment resource.");
    expect(embedded.resource.mimeType).toBe("application/octet-stream");

    await Promise.all([client.close(), server.close()]);
  });

  test("rejects attachments above the MCP response budget", async () => {
    let requestNumber = 0;
    const { server, client } = createPair(async () => {
      requestNumber += 1;
      return Response.json(inboxMessage("application/pdf", 3 * 1024 * 1024 + 1));
    });
    await connect(server, client);

    const result = await client.callTool({
      name: "shipmail_read_mailbox_inbox_attachment",
      arguments: { id: "mbx_123", message_id: "eml_123", part_id: "part_1" },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Attachment exceeds the MCP read limit of 3 MB"),
    });
    expect(requestNumber).toBe(1);

    await Promise.all([client.close(), server.close()]);
  });

  test("limits high-bandwidth attachment reads per session", async () => {
    let requestNumber = 0;
    const { server, client } = createPair(async () => {
      requestNumber += 1;
      return requestNumber % 2 === 1
        ? Response.json(inboxMessage())
        : new Response(new Uint8Array([1, 2, 3, 4]));
    });
    await connect(server, client);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await client.callTool({
        name: "shipmail_read_mailbox_inbox_attachment",
        arguments: { id: "mbx_123", message_id: "eml_123", part_id: "part_1" },
      });
      expect(result.isError).toBeFalsy();
    }

    const limited = await client.callTool({
      name: "shipmail_read_mailbox_inbox_attachment",
      arguments: { id: "mbx_123", message_id: "eml_123", part_id: "part_1" },
    });

    expect(limited.isError).toBe(true);
    expect(limited.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("max 10 per session"),
    });
    expect(requestNumber).toBe(20);

    await Promise.all([client.close(), server.close()]);
  });
});
