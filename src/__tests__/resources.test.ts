import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { ShipmailClient } from "shipmail";

import type { CrossOrganizationGrant } from "../cross-organization-tools.js";
import { CONNECTION_SCOPED_RESOURCE_URIS, registerResources } from "../resources.js";

type StubFetch = (...args: Parameters<typeof fetch>) => Promise<Response>;

function buildPair(
  fetchImpl: StubFetch,
  organizationGrants: readonly CrossOrganizationGrant[] = [],
) {
  const shipmail = new ShipmailClient({
    apiKey: "sk_test",
    baseUrl: "https://api.test/v1",
    maxRetries: 0,
    fetch: fetchImpl as typeof fetch,
  });
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerResources(server, shipmail, undefined, organizationGrants);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  return { server, client };
}

const PAGINATION = { next_cursor: null, has_more: false, limit: 100 };

function mailboxRow(id: string, address: string) {
  return {
    object: "mailbox",
    id: `mbx_${id}`,
    domain_id: `dom_${id}`,
    address,
    display_name: null,
    suspended_at: null,
    suspension_reasons: [],
    spam_filter_threshold: 6,
    auto_reply: { enabled: false, subject: null, body: null, from_date: null, to_date: null },
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  };
}

function domainRow(id: string) {
  return {
    object: "domain",
    id: `dom_${id}`,
    name: `${id}.example.com`,
    status: "verified",
    managed_by: "external",
    dns_provider: null,
    mx_verified: true,
    spf_verified: true,
    dkim_verified: true,
    dmarc_verified: true,
    dmarc_managed_externally: false,
    outbound_verified: true,
    catch_all_mailbox_id: null,
    verified_at: "2025-01-01T00:00:00Z",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  };
}

// Bun's fetch type carries a preconnect method, so a bare handler does not satisfy it. Filling it
// in keeps the stub assignable without a cast.
function stubFetch(handler: StubFetch): typeof fetch {
  return Object.assign(handler, {
    preconnect(_url: string | URL): void {
      // Tests never preconnect.
    },
  });
}

function organizationGrant(id: string, mailboxAddress: string): CrossOrganizationGrant {
  return {
    id,
    name: `Organization ${id}`,
    allowedTools: new Set(["shipmail_list_mailboxes", "shipmail_list_domains"]),
    client: new ShipmailClient({
      apiKey: `sm_test_${id}`,
      baseUrl: "https://api.test/v1",
      maxRetries: 0,
      fetch: stubFetch(async (input) => {
        const path = new URL(String(input)).pathname;
        return Response.json({
          data: [path.endsWith("/domains") ? domainRow(id) : mailboxRow(id, mailboxAddress)],
          pagination: PAGINATION,
        });
      }),
    }),
  };
}

function twoOrganizations(): readonly CrossOrganizationGrant[] {
  return [organizationGrant("one", "first"), organizationGrant("two", "second")];
}

async function connectPair(server: McpServer, client: Client) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
}

function textContent(result: Awaited<ReturnType<Client["readResource"]>>): string {
  const first = result.contents[0];
  if (!first || !("text" in first)) {
    throw new Error("expected text resource content");
  }
  return first.text;
}

describe("MCP resources", () => {
  test("serves the versioned attachment composer with MCP Apps metadata", async () => {
    const { server, client } = buildPair(async () => Response.json({}));
    await connectPair(server, client);

    const listed = await client.listResources();
    expect(listed.resources.map((resource) => resource.uri)).toContain(
      "ui://shipmail/attachment-composer-v1.html",
    );
    const result = await client.readResource({
      uri: "ui://shipmail/attachment-composer-v1.html",
    });
    const content = result.contents[0];
    expect(content?.mimeType).toBe("text/html;profile=mcp-app");
    expect(content && "text" in content ? content.text : "").toContain(
      "shipmail_prepare_staged_attachment_upload",
    );
    expect(content && "text" in content ? content.text : "").toContain(
      "This host cannot call Shipmail tools from the review card.",
    );
    expect(content && "text" in content ? content.text : "").toContain(
      'typeof bridge.getFileDownloadUrl === "function"',
    );
    expect(content?._meta).toMatchObject({
      ui: {
        prefersBorder: true,
      },
    });
  });

  test("serves the newsletter asset uploader with prepared upload metadata", async () => {
    const { server, client } = buildPair(async () => Response.json({}));
    await connectPair(server, client);

    const uri = "ui://shipmail/newsletter-asset-uploader-v1.html";
    expect((await client.listResources()).resources.map((resource) => resource.uri)).toContain(uri);
    const result = await client.readResource({ uri });
    const content = result.contents[0];
    expect(content?.mimeType).toBe("text/html;profile=mcp-app");
    expect(content && "text" in content ? content.text : "").toContain(
      "shipmail_prepare_newsletter_asset_upload",
    );
    expect(content?._meta).toMatchObject({
      ui: {
        prefersBorder: true,
        csp: {
          connectDomains: expect.arrayContaining(["https://*.r2.cloudflarestorage.com"]),
        },
      },
      "openai/widgetCSP": {
        connect_domains: expect.arrayContaining(["https://*.r2.cloudflarestorage.com"]),
      },
    });
  });

  test("lists mailbox inbox, rules, folders, and identities resource templates", async () => {
    const { server, client } = buildPair(async () => Response.json({}));
    await connectPair(server, client);

    const result = await client.listResourceTemplates();
    const templates = result.resourceTemplates.map((template) => template.uriTemplate);

    expect(templates).toContain("shipmail://mailboxes/{id}/folders");
    expect(templates).toContain("shipmail://mailboxes/{id}/identities");
    expect(templates).toContain("shipmail://mailboxes/{id}/rules");
    expect(templates).toContain("shipmail://mailboxes/{id}/inbox/messages");
    expect(templates).toContain("shipmail://mailboxes/{id}/inbox/threads/{thread_id}");
    expect(templates).toContain("shipmail://mailboxes/{mailbox_id}/threads/{id}");
  });

  test("reads the first page of mailbox inbox messages", async () => {
    const calls: URL[] = [];
    const { server, client } = buildPair(async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      expect(url.pathname).toBe("/v1/mailboxes/mbx_123/inbox/messages");
      expect(url.searchParams.get("limit")).toBe("25");
      return Response.json({
        object: "inbox_messages",
        mailbox_id: "mbx_123",
        address: "support@example.com",
        data: [],
        pagination: {
          limit: 25,
          total: 0,
          has_more: false,
          next_cursor: null,
        },
      });
    });
    await connectPair(server, client);

    const result = await client.readResource({
      uri: "shipmail://mailboxes/mbx_123/inbox/messages",
    });

    expect(calls).toHaveLength(1);
    expect(JSON.parse(textContent(result))).toEqual({
      object: "inbox_messages",
      mailbox_id: "mbx_123",
      address: "support@example.com",
      data: [],
      pagination: {
        limit: 25,
        total: 0,
        has_more: false,
        next_cursor: null,
      },
    });
  });
});

// The two URIs that are connection-scoped because they carry no organization data at all. Every
// other connection-scoped URI has to earn it by answering for every organization, which is what
// the guard below checks.
const ORGANIZATION_FREE_URIS: ReadonlySet<string> = new Set([
  "ui://shipmail/attachment-composer-v1.html",
  "ui://shipmail/newsletter-asset-uploader-v1.html",
  "shipmail://account/status",
]);

describe("MCP list resources across organizations", () => {
  // Routing serves these URIs from whichever grant it picked, so an organization-scoped one that
  // stopped aggregating would answer from a single organization without saying so.
  test.each(["shipmail://mailboxes", "shipmail://domains"])(
    "%s reports a section per organization rather than one organization's page",
    async (uri) => {
      const { server, client } = buildPair(async () => Response.json({}), twoOrganizations());
      await connectPair(server, client);

      expect(JSON.parse(textContent(await client.readResource({ uri })))).toMatchObject({
        organizations: [
          { organization: { id: "one" }, status: "ok" },
          { organization: { id: "two" }, status: "ok" },
        ],
      });
    },
  );

  test("keeps the plain single-organization shape for a one-organization connection", async () => {
    const { server, client } = buildPair(async () =>
      Response.json({ data: [], pagination: PAGINATION }),
    );
    await connectPair(server, client);

    expect(
      JSON.parse(textContent(await client.readResource({ uri: "shipmail://mailboxes" }))),
    ).toEqual({ data: [], pagination: PAGINATION });
  });

  // The guard against reintroducing the bug this fixed. Routing serves any URI in the set from an
  // arbitrary grant, so adding one that quietly answers for a single organization would present
  // that organization's rows as the whole connection. A new member has to aggregate, or be added
  // to ORGANIZATION_FREE_URIS on purpose.
  test("every connection-scoped uri is registered and answers for the whole connection", async () => {
    const { server, client } = buildPair(async () => Response.json({}), twoOrganizations());
    await connectPair(server, client);
    const listed = (await client.listResources()).resources.map((resource) => resource.uri);

    for (const uri of CONNECTION_SCOPED_RESOURCE_URIS) {
      expect(listed).toContain(uri);
      if (ORGANIZATION_FREE_URIS.has(uri)) continue;
      expect(JSON.parse(textContent(await client.readResource({ uri })))).toMatchObject({
        organizations: [{ organization: { id: "one" } }, { organization: { id: "two" } }],
      });
    }
  });
});
