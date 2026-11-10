import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { ShipmailClient } from "shipmail";

import {
  addSuppressionInputSchema,
  listSuppressionsInputSchema,
  suppressionOutputSchema,
} from "../schemas.js";
import { registerTools } from "../tools.js";

const SUPPRESSION = {
  object: "suppression",
  email_address: "person@example.com",
  reason: "manual",
  scope: "marketing",
  expires_at: null,
  created_at: "2026-10-14T10:00:00.000Z",
  source: "suppression",
} as const;

const OPTOUT = {
  object: "suppression",
  email_address: "reader@example.com",
  reason: "unsubscribe",
  scope: "marketing",
  expires_at: null,
  created_at: "2026-10-15T10:00:00.000Z",
  source: "newsletter_optout",
  newsletter_id: "nws_1",
  test_send: false,
} as const;

type Captured = {
  readonly method: string | undefined;
  readonly path: string;
  readonly body: unknown;
};

async function callTool(name: string, args: Record<string, unknown>, response: () => Response) {
  const requests: (Captured & { readonly search: string })[] = [];
  const fetchImpl: typeof fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push({
        method: init?.method,
        path: url.pathname,
        search: url.search,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return response();
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
    return {
      result: await client.callTool({ name, arguments: args }),
      requests,
    };
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

function callAddSuppression(args: Record<string, unknown>) {
  return callTool("shipmail_add_suppression", args, () =>
    Response.json(SUPPRESSION, { status: 201 }),
  );
}

describe("addSuppressionInputSchema", () => {
  test("normalizes the address and accepts the two scopes", () => {
    expect(addSuppressionInputSchema.parse({ email: " Person@Example.COM " })).toEqual({
      email: "person@example.com",
    });
    expect(addSuppressionInputSchema.parse({ email: "a@b.com", scope: "all" }).scope).toBe("all");
    expect(() => addSuppressionInputSchema.parse({ email: "a@b.com", scope: "other" })).toThrow();
    // A stream scope comes only from a complaint.
    expect(() =>
      addSuppressionInputSchema.parse({ email: "a@b.com", scope: "transactional" }),
    ).toThrow();
  });
});

describe("stream scopes", () => {
  test("lists and returns entries of every scope", () => {
    for (const scope of ["all", "marketing", "transactional", "mailbox"] as const) {
      expect(listSuppressionsInputSchema.parse({ scope }).scope).toBe(scope);
      expect(
        suppressionOutputSchema.parse({ suppression: { ...SUPPRESSION, scope } }).suppression.scope,
      ).toBe(scope);
    }
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
        search: "",
        body: { email: "person@example.com", scope: "marketing" },
      },
    ]);
  });

  test("leaves the scope to the API default when it is omitted", async () => {
    const { requests } = await callAddSuppression({ email: "person@example.com" });
    expect(requests[0]?.body).toEqual({ email: "person@example.com" });
  });
});

describe("shipmail_list_suppressions", () => {
  test("filters by reason and returns suppressions and newsletter opt-outs together", async () => {
    const { result, requests } = await callTool(
      "shipmail_list_suppressions",
      { reason: "unsubscribe", limit: 10 },
      () =>
        Response.json({
          data: [OPTOUT, SUPPRESSION],
          pagination: { next_cursor: null, has_more: false, limit: 10 },
        }),
    );
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ data: [OPTOUT, SUPPRESSION] });
    expect(new URLSearchParams(requests[0]?.search).get("reason")).toBe("unsubscribe");
    expect(listSuppressionsInputSchema.safeParse({ reason: "other" }).success).toBe(false);
  });
});

describe("shipmail_remove_suppression", () => {
  test("reports a plain removal", async () => {
    const { result, requests } = await callTool(
      "shipmail_remove_suppression",
      { email: "person@example.com" },
      () => new Response(null, { status: 204 }),
    );
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      result: { ok: true, id: "person@example.com", newsletter_optout_remains: false },
    });
    expect(requests[0]).toMatchObject({
      method: "DELETE",
      path: "/api/v1/suppressions/person%40example.com",
    });
  });

  test("says when a newsletter opt-out remains", async () => {
    const message =
      "The suppression was removed. The address still has a newsletter opt-out, so newsletters stay blocked until the reader is resubscribed with fresh consent.";
    const { result } = await callTool(
      "shipmail_remove_suppression",
      { email: "reader@example.com" },
      () =>
        Response.json({
          object: "suppression_removal",
          email_address: "reader@example.com",
          removed: true,
          newsletter_optout_remains: true,
          message,
        }),
    );
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      result: {
        ok: true,
        id: "reader@example.com",
        newsletter_optout_remains: true,
        message,
      },
    });
  });

  test("passes on the conflict when only an opt-out blocks the address", async () => {
    const { result } = await callTool(
      "shipmail_remove_suppression",
      { email: "reader@example.com" },
      () =>
        Response.json(
          {
            error: {
              type: "conflict",
              message:
                "This address unsubscribed from your newsletters. To add them back with fresh consent, use POST /api/v1/audiences/{id}/subscribers/{subscriberId}/resubscribe.",
              details: [
                {
                  field: "email",
                  code: "consent_opt_out",
                  message:
                    "The address has a newsletter opt-out, which only a resubscribe removes.",
                },
              ],
            },
          },
          { status: 409 },
        ),
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("unsubscribed from your newsletters");
    expect(JSON.stringify(result.content)).toContain("type=conflict");
  });
});

describe("shipmail_resubscribe_newsletter_opt_out", () => {
  test("lifts the opt-out with the consent source", async () => {
    const lift = {
      object: "newsletter_opt_out_lift",
      email_address: "reader@example.com",
      consent_source: "Asked to rejoin by email",
      consent_attested_at: "2026-11-09T10:00:00.000Z",
      opted_out_at: "2026-10-15T10:00:00.000Z",
      newsletter_id: "nws_1",
    };
    const { result, requests } = await callTool(
      "shipmail_resubscribe_newsletter_opt_out",
      { email: "reader@example.com", consent_source: "Asked to rejoin by email" },
      () => Response.json(lift),
    );
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ lift });
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/newsletter-opt-outs/reader%40example.com/resubscribe",
      body: { consent_source: "Asked to rejoin by email" },
    });
  });

  test("refuses a call without a consent source", async () => {
    const { result, requests } = await callTool(
      "shipmail_resubscribe_newsletter_opt_out",
      { email: "reader@example.com", consent_source: " " },
      () => Response.json({}),
    );
    expect(result.isError).toBe(true);
    expect(requests).toHaveLength(0);
  });
});
