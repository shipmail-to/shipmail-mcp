import { Client } from "@modelcontextprotocol/client";
import { fromJsonSchema, InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { z } from "zod/v4";

import { MCP_TOOL_NAMES } from "../capabilities.js";
import { messageOutputSchema, threadsOutputSchema } from "../schemas.js";
import { createShipmailMcpServer, type HostedOrganizationGrant } from "../server.js";

// An MCP client caches a tool's outputSchema when it connects and keeps validating responses
// against that copy for the life of the connection. A schema that closes its objects therefore
// turns every field Shipmail adds later into a breaking change: adding `conversation_id` made
// long-lived connections reject every response with "Structured content does not match the tool's
// output schema: data/message must NOT have additional properties". Output schemas must stay open.

const EVERY_TOOL: ReadonlySet<string> = new Set(MCP_TOOL_NAMES);

const GRANTS: readonly HostedOrganizationGrant[] = [
  { id: "org_a", name: "Org A", apiKey: "sk_a", allowedTools: EVERY_TOOL },
  { id: "org_b", name: "Org B", apiKey: "sk_b", allowedTools: EVERY_TOOL },
];

// Two grants so the cross-organization tools register too: they build their output schemas on a
// separate path and would otherwise never be inspected.
async function listTools() {
  const server = createShipmailMcpServer(
    { apiKey: "sk_test", baseUrl: "https://shipmail.to/api/v1", organizationId: undefined },
    EVERY_TOOL,
    GRANTS,
  );
  const client = new Client({ name: "output-schema-test", version: "0.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return (await client.listTools()).tools;
}

function isSchemaNode(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function closedObjectPaths(node: unknown, path: string): readonly string[] {
  if (Array.isArray(node)) {
    return node.flatMap((entry, index) => closedObjectPaths(entry, `${path}[${index}]`));
  }
  if (!isSchemaNode(node)) return [];
  const here = node["additionalProperties"] === false ? [path] : [];
  return Object.getOwnPropertyNames(node).reduce<readonly string[]>(
    (found, key) => [...found, ...closedObjectPaths(node[key], `${path}.${key}`)],
    here,
  );
}

// The exact conversion the SDK publishes without the loosening: used to prove each fixture below
// is otherwise valid, so a passing assertion means the schema opened rather than the payload
// having drifted into something no schema would reject.
function closedJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: "draft-2020-12", io: "output" });
}

async function issuesFrom(schema: Record<string, unknown>, payload: unknown) {
  return (await fromJsonSchema(schema)["~standard"].validate(payload)).issues;
}

const MESSAGE = {
  object: "message",
  id: "msg_123",
  mailbox_id: "mbx_456",
  thread_id: "thr_789",
  conversation_id: "thd_789",
  source_rfc_message_id: "<inbound@example.com>",
  delivered_rfc_message_id: null,
  client_reference: null,
  metadata: {},
  headers: [],
  subject: "Invoice",
  from_address: "sender@example.com",
  to_addresses: [{ address: "billing@example.com" }],
  cc_addresses: null,
  bcc_addresses: null,
  attachments: null,
  source: "inbound",
  mode: "live",
  status: "delivered",
  rule_disposition: null,
  scheduled_at: null,
  created_at: "2026-07-27T10:00:00Z",
  updated_at: "2026-07-27T10:00:00Z",
} as const;

const PAGINATION = { next_cursor: null, has_more: false, limit: 20 } as const;

const THREAD = {
  object: "thread",
  id: "thr_789",
  conversation_id: "thd_789",
  mailbox_id: "mbx_456",
  subject: "Invoice",
  message_count: 1,
  latest_message: MESSAGE,
  created_at: "2026-07-27T10:00:00Z",
  updated_at: "2026-07-27T10:00:00Z",
} as const;

describe("published tool output schemas", () => {
  test("never close an object to properties added later", async () => {
    const tools = await listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.filter((tool) => tool.outputSchema !== undefined).length).toBeGreaterThan(0);

    const closed = tools.flatMap((tool) => closedObjectPaths(tool.outputSchema, tool.name));
    expect(closed).toEqual([]);
  });

  test("still reject unknown arguments on input schemas", async () => {
    const tools = await listTools();
    const closed = tools.flatMap((tool) => closedObjectPaths(tool.inputSchema, tool.name));
    expect(closed.length).toBeGreaterThan(0);
  });
});

describe("a response carrying a field the schema does not list", () => {
  test("passes the published schema of a message-bearing tool", async () => {
    const tools = await listTools();
    const schema = tools.find((tool) => tool.name === "shipmail_get_message")?.outputSchema;
    expect(schema).toBeDefined();
    if (schema === undefined) return;

    const response = {
      message: { ...MESSAGE, future_message_field: "added after the client cached the schema" },
      future_top_level_field: 1,
    };

    expect(await issuesFrom(schema, response)).toBeUndefined();
    // The same payload against the schema this tool published before the fix.
    const closed = closedJsonSchema(messageOutputSchema);
    expect(await issuesFrom(closed, response)).toBeDefined();
    expect(await issuesFrom(closed, { message: MESSAGE })).toBeUndefined();
  });

  test("passes the published schema of a thread-bearing tool", async () => {
    const tools = await listTools();
    const schema = tools.find((tool) => tool.name === "shipmail_list_threads")?.outputSchema;
    expect(schema).toBeDefined();
    if (schema === undefined) return;

    const response = {
      data: [
        {
          ...THREAD,
          future_thread_field: true,
          latest_message: { ...MESSAGE, future_message_field: "nested two levels down" },
        },
      ],
      pagination: PAGINATION,
    };

    expect(await issuesFrom(schema, response)).toBeUndefined();
    const closed = closedJsonSchema(threadsOutputSchema);
    expect(await issuesFrom(closed, response)).toBeDefined();
    expect(await issuesFrom(closed, { data: [THREAD], pagination: PAGINATION })).toBeUndefined();
  });
});
