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
    publish_target: "email_and_website",
    view_in_browser: true,
    feed_entry_url: null,
    styling_mode: "styled",
    track_engagement: false,
    add_utm_tags: false,
    opened_count: null,
    clicked_count: null,
    send_limit: null,
    held_count: 0,
    subject_b: null,
    subject_test_percent: null,
    subject_test_hours: null,
    subject_test_winner: null,
    subject_test_decided_at: null,
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

const MULTILINE_CODE = "const a = 1;\n\tconst b = 2;";

function welcomeStepPayload() {
  return {
    object: "welcome_step",
    id: "nwswstp_123",
    audience_id: "aud_123",
    position: 1,
    wait_minutes: 0,
    sender_identity_id: null,
    subject: "Welcome",
    preview_text: null,
    blocks: [
      { type: "code", code: MULTILINE_CODE },
      { type: "paragraph", body: "Line one<br>\nline two" },
      { type: "image", url: "https://10.0.0.1/a.png", alt: "Stored", link_url: "{{site_url}}" },
    ],
    track_engagement: false,
    add_utm_tags: false,
    styling_mode: "styled",
    sent_count: 0,
    delivered_count: 0,
    bounced_count: 0,
    complained_count: 0,
    created_at: "2026-08-08T00:00:00.000Z",
    updated_at: "2026-08-08T00:00:00.000Z",
  };
}

const RECIPIENT = {
  object: "newsletter_recipient",
  id: "nwsrcp_1",
  newsletter_id: "nws_1",
  email_address: "reader@example.com",
  status: "skipped",
  reason: "opted_out",
  subscriber_id: "audmem_1",
  sent_at: null,
  delivered_at: null,
  bounced_at: null,
  complained_at: null,
  unsubscribed_at: null,
  created_at: "2026-11-09T10:00:00.000Z",
} as const;

const NEWSLETTER_DOMAIN = {
  object: "newsletter_domain",
  id: "nwsdom_1",
  root_domain_name: "example.com",
  domain_name: "news.example.com",
  from_local_part: "updates",
  from_address: "updates@news.example.com",
  mail_from_domain: "bounce.news.example.com",
  reply_to_address: "hello@example.com",
  status: "verified",
  dkim_status: "verified",
  mail_from_status: "verified",
  spf_status: "verified",
  dmarc_status: "verified",
  verified_at: "2026-11-01T10:00:00.000Z",
  dns_records: [],
  created_at: "2026-11-01T09:00:00.000Z",
  updated_at: "2026-11-01T10:00:00.000Z",
} as const;

const SENDER_IDENTITY = {
  object: "newsletter_sender_identity",
  id: "nwsid_1",
  newsletter_domain_id: "nwsdom_1",
  from_name: "Example",
  from_address: "updates@news.example.com",
  business_name: "Example Ltd",
  postal_address: "1 Main Street",
  footer_text: null,
  domain_status: "verified",
  is_default: true,
  created_at: "2026-11-01T09:00:00.000Z",
  updated_at: "2026-11-01T10:00:00.000Z",
} as const;

const PREVIEW = {
  object: "newsletter_preview",
  newsletter_id: "nws_1",
  subject: "Hello Ada",
  html: "<p>Hello Ada</p><p>Example Ltd, 1 Main Street. Unsubscribe</p>",
  archive_html: "<p>Hello</p>",
  text: "Hello Ada",
  headers: {
    "List-Unsubscribe": "<https://shipmail.to/u/abc>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  },
  warnings: [],
  url_breakdown: {
    href_count: 0,
    image_src_count: 0,
    video_href_count: 0,
    text_url_count: 0,
    unique_url_count: 0,
    max_unique_urls: 100,
    urls: [],
    offending_urls: [],
  },
} as const;

async function buildPair(captured: CapturedRequest[]): Promise<Client> {
  const fetcher: typeof fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(String(input));
      captured.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url.pathname.endsWith("/subscribers/resend-confirmation")) {
        return Response.json({
          object: "confirmation_resend",
          audience_id: "aud_123",
          sent: 2,
          failed: 0,
          skipped: { not_found: 0, not_pending: 1, too_old: 0, resend_limit: 0, recently_sent: 0 },
          remaining: 0,
        });
      }
      if (url.pathname.endsWith("/welcome-sequence/steps")) {
        return Response.json(welcomeStepPayload(), { status: 201 });
      }
      if (url.pathname.endsWith("/preview")) return Response.json(PREVIEW);
      if (url.pathname === "/api/v1/newsletter-domains/nwsdom_1") {
        return Response.json(NEWSLETTER_DOMAIN);
      }
      if (url.pathname === "/api/v1/newsletter-sender-identities/nwsid_1") {
        return Response.json(SENDER_IDENTITY);
      }
      if (url.pathname.includes("/recipients/by-email/")) return Response.json(RECIPIENT);
      if (url.pathname.endsWith("/recipients")) {
        return Response.json({
          data: [RECIPIENT],
          pagination: { next_cursor: null, has_more: false, limit: 10 },
        });
      }
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
  test("accepts multiline code and returns whatever blocks the API stored", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);

    const result = await client.callTool({
      name: "shipmail_create_welcome_step",
      arguments: {
        audience_id: "aud_123",
        subject: "Welcome",
        blocks: [{ type: "code", code: MULTILINE_CODE }],
      },
    });

    expect(result.isError).toBeFalsy();
    expect(captured[0]?.body).toContain(JSON.stringify({ type: "code", code: MULTILINE_CODE }));
    expect(JSON.stringify(result.structuredContent)).toContain(JSON.stringify(MULTILINE_CODE));
  });

  test("schedules with a limit and sends to more readers", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);

    const scheduled = await client.callTool({
      name: "shipmail_schedule_newsletter",
      arguments: { id: "nws_1", scheduled_at: "2026-08-10T09:00:00.000Z", limit: 500 },
    });
    expect(scheduled.isError).toBeFalsy();
    const more = await client.callTool({
      name: "shipmail_send_newsletter_to_more",
      arguments: { id: "nws_1", count: 1000 },
    });
    expect(more.isError).toBeFalsy();
    const rest = await client.callTool({
      name: "shipmail_send_newsletter_to_more",
      arguments: { id: "nws_1" },
    });
    expect(rest.isError).toBeFalsy();

    expect(captured.map((request) => request.url.pathname)).toEqual([
      "/api/v1/newsletters/nws_1/schedule",
      "/api/v1/newsletters/nws_1/send-more",
      "/api/v1/newsletters/nws_1/send-more",
    ]);
    expect(captured.map((request) => JSON.parse(request.body ?? "null"))).toEqual([
      { scheduled_at: "2026-08-10T09:00:00.000Z", limit: 500 },
      { count: 1000 },
      {},
    ]);

    const { tools } = await client.listTools();
    expect(
      tools.find((tool) => tool.name === "shipmail_send_newsletter_to_more")?.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  test("resends the confirmation email to pending subscribers", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);

    const chosen = await client.callTool({
      name: "shipmail_resend_subscriber_confirmation",
      arguments: { audience_id: "aud_123", subscriber_ids: ["audmem_1", "audmem_2", "audmem_3"] },
    });
    expect(chosen.isError).toBeFalsy();
    expect(chosen.structuredContent).toMatchObject({ result: { sent: 2, remaining: 0 } });
    const all = await client.callTool({
      name: "shipmail_resend_subscriber_confirmation",
      arguments: { audience_id: "aud_123" },
    });
    expect(all.isError).toBeFalsy();

    expect(captured.map((request) => request.url.pathname)).toEqual([
      "/api/v1/audiences/aud_123/subscribers/resend-confirmation",
      "/api/v1/audiences/aud_123/subscribers/resend-confirmation",
    ]);
    expect(captured.map((request) => JSON.parse(request.body ?? "null"))).toEqual([
      { subscriber_ids: ["audmem_1", "audmem_2", "audmem_3"] },
      {},
    ]);

    const { tools } = await client.listTools();
    const tool = tools.find((entry) => entry.name === "shipmail_resend_subscriber_confirmation");
    expect(tool?.description).toContain("emails real subscribers");
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

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

  test("forwards track_engagement on create and update", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);

    const createResult = await client.callTool({
      name: "shipmail_create_newsletter",
      arguments: {
        audience_id: "aud_123",
        sender_identity_id: "nwsid_123",
        name: "Launch",
        subject: "What shipped",
        body_text: "Launch notes",
        track_engagement: true,
      },
    });
    const updateResult = await client.callTool({
      name: "shipmail_update_newsletter",
      arguments: { id: "nws_123", track_engagement: false },
    });

    expect(createResult.isError).toBeFalsy();
    expect(updateResult.isError).toBeFalsy();
    expect(JSON.parse(captured[0]?.body ?? "{}")).toMatchObject({ track_engagement: true });
    expect(captured[1]?.method).toBe("PATCH");
    expect(JSON.parse(captured[1]?.body ?? "{}")).toEqual({ track_engagement: false });
  });

  test("forwards add_utm_tags on create and update", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);

    const createResult = await client.callTool({
      name: "shipmail_create_newsletter",
      arguments: {
        audience_id: "aud_123",
        sender_identity_id: "nwsid_123",
        name: "Launch",
        subject: "What shipped",
        body_text: "Launch notes",
        add_utm_tags: true,
      },
    });
    const updateResult = await client.callTool({
      name: "shipmail_update_newsletter",
      arguments: { id: "nws_123", add_utm_tags: false },
    });

    expect(createResult.isError).toBeFalsy();
    expect(updateResult.isError).toBeFalsy();
    expect(JSON.parse(captured[0]?.body ?? "{}")).toMatchObject({ add_utm_tags: true });
    expect(JSON.parse(captured[1]?.body ?? "{}")).toEqual({ add_utm_tags: false });
  });

  test("forwards view_in_browser on create and update", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);

    const createResult = await client.callTool({
      name: "shipmail_create_newsletter",
      arguments: {
        audience_id: "aud_123",
        sender_identity_id: "nwsid_123",
        name: "Launch",
        subject: "What shipped",
        body_text: "Launch notes",
        view_in_browser: false,
      },
    });
    const updateResult = await client.callTool({
      name: "shipmail_update_newsletter",
      arguments: { id: "nws_123", view_in_browser: true },
    });

    expect(createResult.isError).toBeFalsy();
    expect(updateResult.isError).toBeFalsy();
    expect(JSON.parse(captured[0]?.body ?? "{}")).toMatchObject({ view_in_browser: false });
    expect(JSON.parse(captured[1]?.body ?? "{}")).toEqual({ view_in_browser: true });
  });

  test("forwards subject test changes on update, including removing the test", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);

    const setResult = await client.callTool({
      name: "shipmail_update_newsletter",
      arguments: {
        id: "nws_123",
        subject_b: "Subject B",
        subject_test_percent: 20,
        subject_test_hours: 6,
      },
    });
    const removeResult = await client.callTool({
      name: "shipmail_update_newsletter",
      arguments: { id: "nws_123", name: "Launch", subject_b: null },
    });

    expect(setResult.isError).toBeFalsy();
    expect(removeResult.isError).toBeFalsy();
    expect(JSON.parse(captured[0]?.body ?? "{}")).toEqual({
      subject_b: "Subject B",
      subject_test_percent: 20,
      subject_test_hours: 6,
    });
    expect(JSON.parse(captured[1]?.body ?? "{}")).toEqual({ name: "Launch", subject_b: null });
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

describe("newsletter consent and results tools", () => {
  test("previews as a subscriber and returns the subject and headers", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);

    const asReader = await client.callTool({
      name: "shipmail_preview_newsletter",
      arguments: { id: "nws_1", preview_as: { type: "subscriber", subscriber_id: "audmem_1" } },
    });
    expect(asReader.isError).toBeFalsy();
    expect(asReader.structuredContent).toMatchObject({
      preview: { subject: "Hello Ada", headers: PREVIEW.headers },
    });
    const sample = await client.callTool({
      name: "shipmail_preview_newsletter",
      arguments: { id: "nws_1" },
    });
    expect(sample.isError).toBeFalsy();

    expect(captured.map((request) => request.url.pathname)).toEqual([
      "/api/v1/newsletters/nws_1/preview",
      "/api/v1/newsletters/nws_1/preview",
    ]);
    expect(JSON.parse(captured[0]?.body ?? "null")).toEqual({
      preview_as: { type: "subscriber", subscriber_id: "audmem_1" },
    });
    expect(captured[1]?.body).toBeUndefined();
  });

  test("rejects a subscriber preview without a subscriber ID", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);

    const result = await client.callTool({
      name: "shipmail_preview_newsletter",
      arguments: { id: "nws_1", preview_as: { type: "subscriber" } },
    });
    expect(result.isError).toBe(true);
    expect(captured).toHaveLength(0);
  });

  test("gets one newsletter domain and one sender identity", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);

    const domain = await client.callTool({
      name: "shipmail_get_newsletter_domain",
      arguments: { id: "nwsdom_1" },
    });
    expect(domain.structuredContent).toEqual({ newsletter_domain: NEWSLETTER_DOMAIN });
    const identity = await client.callTool({
      name: "shipmail_get_newsletter_sender_identity",
      arguments: { id: "nwsid_1" },
    });
    expect(identity.structuredContent).toEqual({ newsletter_sender_identity: SENDER_IDENTITY });
    expect(captured.map((request) => `${request.method} ${request.url.pathname}`)).toEqual([
      "GET /api/v1/newsletter-domains/nwsdom_1",
      "GET /api/v1/newsletter-sender-identities/nwsid_1",
    ]);
  });

  test("lists recipients with filters and gets one by email", async () => {
    const captured: CapturedRequest[] = [];
    const client = await buildPair(captured);

    const list = await client.callTool({
      name: "shipmail_list_newsletter_recipients",
      arguments: { id: "nws_1", status: "skipped", reason: "opted_out", limit: 10, cursor: "abc" },
    });
    expect(list.isError).toBeFalsy();
    expect(list.structuredContent).toMatchObject({ data: [RECIPIENT] });
    const one = await client.callTool({
      name: "shipmail_get_newsletter_recipient_by_email",
      arguments: { id: "nws_1", email: "Reader@Example.com" },
    });
    expect(one.structuredContent).toEqual({ recipient: RECIPIENT });

    expect(captured[0]?.url.pathname).toBe("/api/v1/newsletters/nws_1/recipients");
    expect(Object.fromEntries(captured[0]?.url.searchParams ?? [])).toEqual({
      status: "skipped",
      reason: "opted_out",
      limit: "10",
      cursor: "abc",
    });
    expect(captured[1]?.url.pathname).toBe(
      "/api/v1/newsletters/nws_1/recipients/by-email/reader%40example.com",
    );

    const invalid = await client.callTool({
      name: "shipmail_list_newsletter_recipients",
      arguments: { id: "nws_1", reason: "raw provider text" },
    });
    expect(invalid.isError).toBe(true);
    expect(captured).toHaveLength(2);
  });
});
