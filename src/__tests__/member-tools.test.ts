import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { ShipmailClient } from "shipmail";

import { memberOutputSchema, memberSchema, membersOutputSchema } from "../schemas.js";
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
