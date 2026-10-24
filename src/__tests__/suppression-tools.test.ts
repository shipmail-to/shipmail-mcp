import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { ShipmailClient } from "shipmail";

import { addSuppressionInputSchema, suppressionOutputSchema } from "../schemas.js";
import { registerTools } from "../tools.js";

const SUPPRESSION = {
  object: "suppression",
  email_address: "person@example.com",
  reason: "manual",
  scope: "marketing",
  expires_at: null,
  created_at: "2026-10-14T10:00:00.000Z",
} as const;

type Captured = {
  readonly method: string | undefined;
  readonly path: string;
  readonly body: unknown;
};

async function callAddSuppression(args: Record<string, unknown>) {
  const requests: Captured[] = [];
  const fetchImpl: typeof fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        method: init?.method,
        path: new URL(String(input)).pathname,
        body: JSON.parse(String(init?.body)),
      });
      return Response.json(SUPPRESSION, { status: 201 });
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
  registerTools(server, shipmail, new Set(["shipmail_add_suppression"]));
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    return {
      result: await client.callTool({ name: "shipmail_add_suppression", arguments: args }),
      requests,
    };
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

describe("addSuppressionInputSchema", () => {
  test("normalizes the address and accepts the two scopes", () => {
    expect(addSuppressionInputSchema.parse({ email: " Person@Example.COM " })).toEqual({
      email: "person@example.com",
    });
    expect(addSuppressionInputSchema.parse({ email: "a@b.com", scope: "all" }).scope).toBe("all");
    expect(() => addSuppressionInputSchema.parse({ email: "a@b.com", scope: "other" })).toThrow();
  });
});

describe("shipmail_add_suppression", () => {
  test("posts the address and scope and returns the suppression", async () => {
    const { result, requests } = await callAddSuppression({
      email: "person@example.com",
      scope: "marketing",
    });
    expect(result.isError).toBeFalsy();
    expect(suppressionOutputSchema.parse(result.structuredContent)).toEqual({
      suppression: SUPPRESSION,
    });
    expect(requests).toEqual([
      {
        method: "POST",
        path: "/api/v1/suppressions",
        body: { email: "person@example.com", scope: "marketing" },
      },
    ]);
  });

  test("leaves the scope to the API default when it is omitted", async () => {
    const { requests } = await callAddSuppression({ email: "person@example.com" });
    expect(requests[0]?.body).toEqual({ email: "person@example.com" });
  });
});
