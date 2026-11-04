import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { type Customer, ShipmailClient } from "shipmail";

import { customerOutputSchema, inboxThreadSummarySchema } from "../schemas.js";
import { registerTools } from "../tools.js";

const CUSTOMER: Customer = {
  object: "customer",
  id: "cust_123",
  name: "Jane Doe",
  company: "Acme",
  notes: null,
  service_level_id: "svl_123",
  fields: { plan: "enterprise" },
  tags: ["vip"],
  identifiers: [{ kind: "email", value: "jane@acme.com" }],
  external_ids: [{ source: "hubspot", external_id: "contact/42", url: null }],
  created_at: "2026-11-01T10:00:00.000Z",
  updated_at: "2026-11-01T10:00:00.000Z",
};

type Captured = {
  readonly method: string | undefined;
  readonly path: string;
  readonly body: unknown;
};

async function callTool(name: string, args: Record<string, unknown>) {
  const requests: Captured[] = [];
  const fetchImpl: typeof fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        method: init?.method,
        path: new URL(String(input)).pathname,
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      return Response.json(CUSTOMER);
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
    return { result: await client.callTool({ name, arguments: args }), requests };
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

describe("shipmail_upsert_customer_by_external_id", () => {
  test("encodes the external id once and sends the profile", async () => {
    const { result, requests } = await callTool("shipmail_upsert_customer_by_external_id", {
      source: "hubspot",
      external_id: "contact/42",
      name: "Jane Doe",
      identifiers: [{ kind: "email", value: "jane@acme.com" }],
      tags: ["vip", "beta"],
    });
    expect(result.isError).toBeFalsy();
    expect(customerOutputSchema.parse(result.structuredContent).customer.id).toBe("cust_123");
    expect(result.structuredContent).toEqual({ customer: CUSTOMER });
    expect(requests).toEqual([
      {
        method: "PUT",
        path: "/api/v1/customers/external/hubspot/contact%2F42",
        body: {
          name: "Jane Doe",
          identifiers: [{ kind: "email", value: "jane@acme.com" }],
          tags: ["vip", "beta"],
        },
      },
    ]);
  });

  test("refuses a source that is not a slug", async () => {
    const { result, requests } = await callTool("shipmail_upsert_customer_by_external_id", {
      source: "Hub Spot",
      external_id: "42",
    });
    expect(result.isError).toBe(true);
    expect(requests).toEqual([]);
  });
});

describe("shipmail_update_customer", () => {
  test("patches only the given properties", async () => {
    const { requests } = await callTool("shipmail_update_customer", {
      id: "cust_123",
      service_level_id: null,
    });
    expect(requests).toEqual([
      { method: "PATCH", path: "/api/v1/customers/cust_123", body: { service_level_id: null } },
    ]);
  });
});

describe("shipmail_list_customers", () => {
  test("filters by tag", async () => {
    const requests: string[] = [];
    const fetchImpl: typeof fetch = Object.assign(
      async (input: string | URL | Request) => {
        const url = new URL(String(input));
        requests.push(`${url.pathname}?${url.searchParams.toString()}`);
        return Response.json({
          data: [CUSTOMER],
          pagination: { next_cursor: null, has_more: false, limit: 20 },
        });
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
    registerTools(server, shipmail, new Set(["shipmail_list_customers"]));
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({
        name: "shipmail_list_customers",
        arguments: { tag: "vip" },
      });
      expect(result.isError).toBeFalsy();
      expect(requests).toEqual(["/api/v1/customers?limit=25&tag=vip"]);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});

describe("inboxThreadSummarySchema", () => {
  test("carries the customer and the reply target", () => {
    const parsed = inboxThreadSummarySchema.shape.reply_target.parse({
      state: "at_risk",
      service_level_id: null,
      started_at: "2026-11-01T08:00:00.000Z",
      warn_at: "2026-11-01T11:00:00.000Z",
      due_at: "2026-11-01T12:00:00.000Z",
    });
    expect(parsed?.state).toBe("at_risk");
    expect(inboxThreadSummarySchema.shape.customer_id.parse(null)).toBeNull();
  });
});
