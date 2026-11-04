import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { ShipmailClient } from "shipmail";

import { getMcpCapability } from "../capabilities.js";
import { eventQueueSchema } from "../schemas.js";
import { registerTools } from "../tools.js";

const EVENT_QUEUE = eventQueueSchema.parse({
  object: "event_queue",
  id: "evq_123",
  events: ["message.received"],
  description: null,
  mailbox_ids: null,
  domain_ids: null,
  include_reply_text: false,
  authenticated_senders_only: true,
  allowed_senders: null,
  created_at: "2026-11-04T10:00:00.000Z",
});

const ENVELOPE = {
  version: "2026-07-20",
  event_id: "evt_001",
  event_type: "message.received",
  created_at: "2026-11-04T10:01:00.000Z",
  test: false,
  data: { message_id: "msg_1" },
};

type CapturedRequest = { readonly method: string; readonly url: URL; readonly body: unknown };

async function callTool(
  name: string,
  args: Record<string, unknown>,
  respond: (request: CapturedRequest) => Response,
) {
  const requests: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const request: CapturedRequest = {
        method: init?.method ?? "GET",
        url: new URL(String(input)),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      requests.push(request);
      return respond(request);
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
    return { result, requests };
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

describe("event queue tools", () => {
  test("create sends the filters and returns the queue", async () => {
    const { result, requests } = await callTool(
      "shipmail_create_event_queue",
      { events: ["message.received"], authenticated_senders_only: true },
      () => Response.json(EVENT_QUEUE, { status: 201 }),
    );

    expect(result.isError).toBeFalsy();
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url.pathname).toBe("/api/v1/event-queues");
    expect(requests[0]?.body).toEqual({
      events: ["message.received"],
      authenticated_senders_only: true,
    });
    expect(result.structuredContent).toMatchObject({ event_queue: { id: "evq_123" } });
  });

  test("list events passes limit and returns the envelopes", async () => {
    const { result, requests } = await callTool(
      "shipmail_list_event_queue_events",
      { id: "evq_123", limit: 100 },
      () => Response.json({ data: [ENVELOPE], has_more: false }),
    );

    expect(result.isError).toBeFalsy();
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url.pathname).toBe("/api/v1/event-queues/evq_123/events");
    expect(requests[0]?.url.searchParams.get("limit")).toBe("100");
    expect(result.structuredContent).toMatchObject({
      data: [{ event_id: "evt_001" }],
      has_more: false,
    });
  });

  test("ack sends event_ids and returns the count", async () => {
    const { result, requests } = await callTool(
      "shipmail_ack_event_queue_events",
      { id: "evq_123", event_ids: ["evt_001", "evt_002"] },
      () => Response.json({ acknowledged: 1 }),
    );

    expect(result.isError).toBeFalsy();
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url.pathname).toBe("/api/v1/event-queues/evq_123/events/ack");
    expect(requests[0]?.body).toEqual({ event_ids: ["evt_001", "evt_002"] });
    expect(result.structuredContent).toEqual({ acknowledged: 1 });
  });

  test("ack rejects an empty event_ids list before calling the API", async () => {
    const { result, requests } = await callTool(
      "shipmail_ack_event_queue_events",
      { id: "evq_123", event_ids: [] },
      () => Response.json({ acknowledged: 0 }),
    );

    expect(result.isError).toBe(true);
    expect(requests).toEqual([]);
  });

  test("delete removes the queue", async () => {
    const { result, requests } = await callTool(
      "shipmail_delete_event_queue",
      { id: "evq_123" },
      () => new Response(null, { status: 204 }),
    );

    expect(result.isError).toBeFalsy();
    expect(requests[0]?.method).toBe("DELETE");
    expect(requests[0]?.url.pathname).toBe("/api/v1/event-queues/evq_123");
  });

  test("capabilities use the webhook scopes and mark deletion as destructive", () => {
    expect(getMcpCapability("shipmail_list_event_queue_events")).toMatchObject({
      requiredScope: "webhooks:read",
      permissionGroup: "webhooks",
      effect: "read",
    });
    expect(getMcpCapability("shipmail_create_event_queue")).toMatchObject({
      requiredScope: "webhooks:write",
      effect: "local_write",
      duration: "persistent",
    });
    expect(getMcpCapability("shipmail_ack_event_queue_events")?.annotations.destructiveHint).toBe(
      true,
    );
    expect(getMcpCapability("shipmail_delete_event_queue")?.effect).toBe("destructive");
  });
});
