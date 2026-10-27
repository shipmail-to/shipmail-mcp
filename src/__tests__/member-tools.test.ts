import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { ShipmailClient } from "shipmail";

import {
  invitationOutputSchema,
  invitationSchema,
  invitationsOutputSchema,
  inviteMemberInputSchema,
  memberOutputSchema,
  memberSchema,
  membersOutputSchema,
} from "../schemas.js";
import { registerTools } from "../tools.js";

const PAGINATION = { next_cursor: null, has_more: false, limit: 25 };

const OWNER = memberSchema.parse({
  object: "member",
  id: "mem_owner",
  email: "owner@example.com",
  name: "Owner",
  role: "owner",
  mailbox_access: { scope: "all", mailbox_ids: [] },
  created_at: "2026-10-02T10:00:00Z",
});

const SELECTED_MEMBER = memberSchema.parse({
  object: "member",
  id: "mem_member",
  email: "member@example.com",
  name: "Member",
  role: "member",
  mailbox_access: { scope: "selected", mailbox_ids: ["mbx_visible"] },
  created_at: "2026-10-02T10:01:00Z",
});

async function callMemberTool(name: "shipmail_list_members" | "shipmail_get_member") {
  const fetchImpl: typeof fetch = Object.assign(
    async () =>
      Response.json(
        name === "shipmail_list_members"
          ? { data: [OWNER, SELECTED_MEMBER], pagination: PAGINATION }
          : SELECTED_MEMBER,
      ),
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
    return await client.callTool({
      name,
      arguments: name === "shipmail_get_member" ? { id: SELECTED_MEMBER.id } : {},
    });
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

describe("member output schemas", () => {
  test("accept the three public roles and credential-filtered selected mailbox IDs", () => {
    for (const role of ["owner", "admin", "member"] as const) {
      expect(memberSchema.parse({ ...SELECTED_MEMBER, role }).role).toBe(role);
    }
    expect(memberSchema.parse(SELECTED_MEMBER).mailbox_access).toEqual({
      scope: "selected",
      mailbox_ids: ["mbx_visible"],
    });
  });

  test("reject super_admin and require an empty mailbox list for all access", () => {
    expect(memberSchema.safeParse({ ...SELECTED_MEMBER, role: "super_admin" }).success).toBe(false);
    expect(
      memberSchema.safeParse({
        ...OWNER,
        mailbox_access: { scope: "all", mailbox_ids: ["mbx_hidden"] },
      }).success,
    ).toBe(false);
  });
});

describe("member tools", () => {
  test("list members returns all and partial selected mailbox access", async () => {
    const result = await callMemberTool("shipmail_list_members");
    expect(result.isError).toBeFalsy();
    expect(membersOutputSchema.parse(result.structuredContent)).toEqual({
      data: [OWNER, SELECTED_MEMBER],
      pagination: PAGINATION,
    });
  });

  test("get member returns credential-filtered selected mailbox access", async () => {
    const result = await callMemberTool("shipmail_get_member");
    expect(result.isError).toBeFalsy();
    expect(memberOutputSchema.parse(result.structuredContent)).toEqual({ member: SELECTED_MEMBER });
  });
});

const INVITATION = invitationSchema.parse({
  object: "invitation",
  id: "inv_sam",
  email: "sam@example.com",
  role: "member",
  mailbox_access: { scope: "selected", mailbox_ids: ["mbx_visible"] },
  newsletter_role: "editor",
  created_at: "2026-10-27T10:00:00Z",
  expires_at: "2026-11-03T10:00:00Z",
});

type CapturedRequest = {
  method: string;
  path: string;
  body: unknown;
  idempotencyKey: string | null;
};

async function callWriteTool(
  name: string,
  args: Record<string, unknown>,
  respond: (request: Request) => Response,
) {
  const requests: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const text = await request.text();
      requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        body: text ? JSON.parse(text) : undefined,
        idempotencyKey: request.headers.get("idempotency-key"),
      });
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
    return { result: await client.callTool({ name, arguments: args }), requests };
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

describe("member write tools", () => {
  test("list invitations returns pending invitations", async () => {
    const { result, requests } = await callWriteTool("shipmail_list_member_invitations", {}, () =>
      Response.json({ data: [INVITATION] }),
    );
    expect(result.isError).toBeFalsy();
    expect(invitationsOutputSchema.parse(result.structuredContent)).toEqual({ data: [INVITATION] });
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "GET /api/v1/members/invitations",
    ]);
  });

  test("invite sends the invitation with an idempotency key", async () => {
    const { result, requests } = await callWriteTool(
      "shipmail_invite_member",
      {
        email: "Sam@Example.com",
        role: "member",
        mailbox_ids: ["mbx_visible"],
        newsletter_role: "editor",
        idempotency_key: "invite-sam",
      },
      () => Response.json(INVITATION, { status: 201 }),
    );
    expect(result.isError).toBeFalsy();
    expect(invitationOutputSchema.parse(result.structuredContent)).toEqual({
      invitation: INVITATION,
    });
    expect(requests).toEqual([
      {
        method: "POST",
        path: "/api/v1/members/invitations",
        body: {
          email: "sam@example.com",
          role: "member",
          mailbox_ids: ["mbx_visible"],
          newsletter_role: "editor",
        },
        idempotencyKey: "invite-sam",
      },
    ]);
  });

  test("invite input refuses a newsletter editor role for an admin", () => {
    expect(
      inviteMemberInputSchema.safeParse({
        email: "ops@example.com",
        role: "admin",
        newsletter_role: "editor",
      }).success,
    ).toBe(false);
    expect(
      inviteMemberInputSchema.safeParse({ email: "ops@example.com", role: "owner" }).success,
    ).toBe(false);
  });

  test("cancel invitation acknowledges the cancelled ID", async () => {
    const { result, requests } = await callWriteTool(
      "shipmail_cancel_member_invitation",
      { id: "inv_sam" },
      () => new Response(null, { status: 204 }),
    );
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ result: { ok: true, id: "inv_sam" } });
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "DELETE /api/v1/members/invitations/inv_sam",
    ]);
  });

  test("grant and revoke mailbox access return the member", async () => {
    for (const [name, method] of [
      ["shipmail_grant_member_mailbox_access", "PUT"],
      ["shipmail_revoke_member_mailbox_access", "DELETE"],
    ] as const) {
      const { result, requests } = await callWriteTool(
        name,
        { id: SELECTED_MEMBER.id, mailbox_id: "mbx_visible" },
        () => Response.json(SELECTED_MEMBER),
      );
      expect(result.isError).toBeFalsy();
      expect(memberOutputSchema.parse(result.structuredContent)).toEqual({
        member: SELECTED_MEMBER,
      });
      expect(requests).toEqual([
        {
          method,
          path: "/api/v1/members/mem_member/mailboxes/mbx_visible",
          body: undefined,
          idempotencyKey: null,
        },
      ]);
    }
  });
});
