import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { ShipmailClient } from "shipmail";

import { newsletterAssetsOutputSchema } from "../schemas.js";
import { registerTools } from "../tools.js";

type CapturedRequest = {
  readonly url: URL;
  readonly method: string;
  readonly body: string | undefined;
};

function newsletterPayload() {
  return {
    object: "newsletter",
    id: "nws_123",
    audience_id: "aud_123",
    sender_identity_id: "nwsid_123",
    newsletter_domain_id: "nwsdom_123",
    name: "Launch",
    subject: "What shipped",
    preview_text: null,
    from_name: "Shipmail",
    from_address: "news@example.com",
    reply_to_address: null,
    blocks: [
      {
        type: "paragraph",
        body: '<a href="https://example.com/launch">Launch notes</a>',
      },
    ],
    body_html: '<p><a href="https://example.com/launch">Launch notes</a></p>',
    body_text: "Launch notes",
    status: "draft",
    archive_visibility: "private",
    feed_entry_url: null,
    styling_mode: "styled",
    preflight_status: "not_run",
    preflight_results: {},
    send_window_hours: 6,
    send_rate_per_hour: 500,
    recipient_count: 0,
    sent_count: 0,
    delivered_count: 0,
    bounced_count: 0,
    complained_count: 0,
    failed_count: 0,
    skipped_count: 0,
    last_test_sent_at: null,
    last_test_recipient: null,
    content_changed_since_test_send: false,
    scheduled_at: null,
    approved_at: null,
    started_at: null,
    published_at: null,
    archive_url: null,
    completed_at: null,
    cancelled_at: null,
    created_at: "2026-08-08T00:00:00.000Z",
    updated_at: "2026-08-08T00:00:00.000Z",
  };
}

async function buildPair(captured: CapturedRequest[]): Promise<Client> {
  const fetcher: typeof fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(String(input));
      captured.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url.pathname === "/api/v1/newsletter-assets") {
        return Response.json({
          data: [],
          pagination: { next_cursor: "next-page", has_more: true, limit: 24 },
          storage: {
            used_bytes: 1_024,
            limit_bytes: null,
            remaining_bytes: null,
            over_limit: false,
            plan: "free",
            is_in_trial: false,
            next_upgrade: null,
          },
        });
      }
      return Response.json(newsletterPayload(), { status: init?.method === "POST" ? 201 : 200 });
    },
    { preconnect: fetch.preconnect },
  );
  const shipmail = new ShipmailClient({
    apiKey: "sm_test",
    baseUrl: "https://shipmail.to/api/v1",
    maxRetries: 0,
    fetch: fetcher,
  });
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, shipmail, undefined);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("newsletter MCP tools", () => {
  test("lists filtered, paginated assets with unlimited storage", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);

    const result = await client.callTool({
      name: "shipmail_list_newsletter_assets",
      arguments: { kind: "image", q: "hero", limit: 24, cursor: "current-page" },
    });

    expect(result.isError).toBeFalsy();
    const output = newsletterAssetsOutputSchema.parse(result.structuredContent);
    expect(output.pagination).toEqual({
      next_cursor: "next-page",
      has_more: true,
      limit: 24,
    });
    expect(output.storage.limit_bytes).toBeNull();
    expect(output.storage.remaining_bytes).toBeNull();
    expect(captured[0]?.url.searchParams.get("kind")).toBe("image");
    expect(captured[0]?.url.searchParams.get("q")).toBe("hero");
    expect(captured[0]?.url.searchParams.get("limit")).toBe("24");
    expect(captured[0]?.url.searchParams.get("cursor")).toBe("current-page");
  });

  test("forwards rich block prose on create and update", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);
    const createBody =
      '<p>Read the <a href="https://example.com/create">launch notes</a> with <strong>details</strong>.</p>';
    const updateBody =
      '<p>Read the <a href="https://example.com/update">updated notes</a> with <em>context</em>.</p>';

    const createResult = await client.callTool({
      name: "shipmail_create_newsletter",
      arguments: {
        audience_id: "aud_123",
        sender_identity_id: "nwsid_123",
        name: "Launch",
        subject: "What shipped",
        blocks: [
          { type: "paragraph", body: createBody },
          {
            type: "columns",
            left: {
              image_url: "https://cdn.example.com/left.png",
              image_alt: "Left preview",
              image_fit: "contain",
            },
            right: { title: "Right column" },
          },
        ],
      },
    });
    const updateResult = await client.callTool({
      name: "shipmail_update_newsletter",
      arguments: {
        id: "nws_123",
        blocks: [{ type: "callout", body: updateBody }],
      },
    });

    expect(createResult.isError).toBeFalsy();
    expect(updateResult.isError).toBeFalsy();
    expect(captured[0]?.url.pathname).toBe("/api/v1/newsletters");
    expect(captured[0]?.method).toBe("POST");
    expect(captured[0]?.body).toContain(JSON.stringify({ type: "paragraph", body: createBody }));
    expect(captured[0]?.body).toContain(
      JSON.stringify({
        type: "columns",
        left: {
          image_url: "https://cdn.example.com/left.png",
          image_alt: "Left preview",
          image_fit: "contain",
        },
        right: { title: "Right column" },
      }),
    );
    expect(captured[1]?.url.pathname).toBe("/api/v1/newsletters/nws_123");
    expect(captured[1]?.method).toBe("PATCH");
    expect(captured[1]?.body).toContain(JSON.stringify({ type: "callout", body: updateBody }));
  });

  test("rejects half-filled column CTAs before calling the API", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);

    const result = await client.callTool({
      name: "shipmail_create_newsletter",
      arguments: {
        audience_id: "aud_123",
        sender_identity_id: "nwsid_123",
        name: "Launch",
        subject: "What shipped",
        blocks: [
          {
            type: "columns",
            left: { title: "Left", cta_label: "Read more" },
            right: { title: "Right" },
          },
        ],
      },
    });

    expect(result.isError).toBe(true);
    expect(captured).toHaveLength(0);
  });
});
