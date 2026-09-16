import { Client } from "@modelcontextprotocol/client";
import { fromJsonSchema, InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { z } from "zod/v4";

import { MCP_TOOL_NAMES } from "../capabilities.js";
import { openJsonSchemaObjects } from "../output-schema.js";
import {
  automationOutputSchema,
  importOutputSchema,
  messageOutputSchema,
  threadsOutputSchema,
} from "../schemas.js";
import { createShipmailMcpServer, type HostedOrganizationGrant } from "../server.js";

// An MCP client caches a tool's outputSchema when it connects and keeps validating responses
// against that copy for the life of the connection. A schema that closes its objects therefore
// turns every field Shipmail adds later into a breaking change: adding `conversation_id` made
// long-lived connections reject every response with "Structured content does not match the tool's
// output schema: data/message must NOT have additional properties". Output schemas must stay open.
//
// The same holds for the values a field may take. Adding "skipped" to the import folder states
// makes every cached copy of a closed `enum` reject a response that reports a skipped folder, so a
// published output schema promises a field is a string and never which strings it will ever be.

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

// Keyword positions holding a schema, or a list of them. Walking only these is what keeps a
// property legitimately named "enum" from being mistaken for the keyword.
const SCHEMA_KEYS = [
  "additionalItems",
  "additionalProperties",
  "allOf",
  "anyOf",
  "contains",
  "else",
  "if",
  "items",
  "not",
  "oneOf",
  "prefixItems",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
] as const;

// Keyword positions holding a record of schemas keyed by a name the author chose.
const SCHEMA_RECORD_KEYS = [
  "$defs",
  "definitions",
  "dependentSchemas",
  "patternProperties",
  "properties",
] as const;

function closedValuePaths(node: unknown, path: string): readonly string[] {
  if (Array.isArray(node)) {
    return node.flatMap((entry, index) => closedValuePaths(entry, `${path}[${index}]`));
  }
  if (!isSchemaNode(node)) return [];
  const type = node["type"];
  const stringTyped = type === "string" || (Array.isArray(type) && type.includes("string"));
  const here = stringTyped
    ? ["enum", "const"].filter((keyword) => keyword in node).map((keyword) => `${path}.${keyword}`)
    : [];
  const nested = SCHEMA_KEYS.flatMap((key) => closedValuePaths(node[key], `${path}.${key}`));
  const recorded = SCHEMA_RECORD_KEYS.flatMap((key) => {
    const record = node[key];
    if (!isSchemaNode(record)) return [];
    return Object.getOwnPropertyNames(record).flatMap((name) =>
      closedValuePaths(record[name], `${path}.${key}.${name}`),
    );
  });
  return [...here, ...nested, ...recorded];
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

const IMPORT_FOLDER = {
  source_folder: "INBOX",
  target_folder: "Inbox",
  role: "inbox",
  state: "completed",
  found: 3,
  imported: 3,
  duplicates: 0,
  oversize: 0,
  failed: 0,
} as const;

const IMPORT = {
  object: "import",
  id: "imp_123",
  mailbox_id: "mbx_456",
  kind: "imap",
  provider: "gmail",
  source_address: "old@example.com",
  status: "completed",
  status_detail: null,
  error: null,
  resume_at: null,
  counts: {
    found: 3,
    imported: 3,
    undone: 0,
    duplicates_skipped: 0,
    oversize_skipped: 0,
    failed: 0,
    contacts_imported: 0,
  },
  bytes: { total: 1024, imported: 1024 },
  created_at: "2026-09-11T10:00:00Z",
  started_at: "2026-09-11T10:00:01Z",
  completed_at: "2026-09-11T10:05:00Z",
  folders: [IMPORT_FOLDER],
} as const;

const AUTOMATION = {
  object: "automation",
  id: "aut_123",
  name: "Triage invoices",
  status: "active",
  version_id: "autv_1",
  version: 1,
  definition: {
    trigger: { type: "email_received", mailbox_ids: ["mbx_456"] },
    conditions: [{ type: "sender_domain", domains: ["example.com"] }],
    actions: [{ type: "archive_trigger_message" }],
    mode: "draft",
    scope: { mailbox_ids: ["mbx_456"], calendar_addresses: [] },
  },
  last_run: null,
  next_run_at: null,
  created_at: "2026-09-11T10:00:00Z",
  updated_at: "2026-09-11T10:00:00Z",
} as const;

describe("published tool output schemas", () => {
  test("never close an object to properties added later", async () => {
    const tools = await listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.filter((tool) => tool.outputSchema !== undefined).length).toBeGreaterThan(0);

    const closed = tools.flatMap((tool) => closedObjectPaths(tool.outputSchema, tool.name));
    expect(closed).toEqual([]);
  });

  test("never close a string field to values added later", async () => {
    const tools = await listTools();
    expect(tools.filter((tool) => tool.outputSchema !== undefined).length).toBeGreaterThan(0);

    const closed = tools.flatMap((tool) => closedValuePaths(tool.outputSchema, tool.name));
    expect(closed).toEqual([]);
  });

  test("still reject unknown arguments on input schemas", async () => {
    const tools = await listTools();
    const closed = tools.flatMap((tool) => closedObjectPaths(tool.inputSchema, tool.name));
    expect(closed.length).toBeGreaterThan(0);
  });

  test("still reject unknown argument values on input schemas", async () => {
    const tools = await listTools();
    const closed = tools.flatMap((tool) => closedValuePaths(tool.inputSchema, tool.name));
    expect(closed.length).toBeGreaterThan(0);

    const createImport = tools.find((tool) => tool.name === "shipmail_create_mailbox_import");
    expect(createImport).toBeDefined();
    const range = createImport?.inputSchema?.properties?.["range"];
    expect(isSchemaNode(range) ? range["enum"] : undefined).toEqual(["all", "12m", "3m", "1m"]);
    expect(
      await issuesFrom(createImport?.inputSchema ?? {}, { id: "mbx_1", range: "6m" }),
    ).toBeDefined();
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

describe("a response carrying a string value the schema does not list", () => {
  test("passes the published schema when an import reports a folder state added later", async () => {
    const tools = await listTools();
    const schema = tools.find((tool) => tool.name === "shipmail_get_mailbox_import")?.outputSchema;
    expect(schema).toBeDefined();
    if (schema === undefined) return;

    // "skipped" shipped after clients had cached the schema; the next state will do the same.
    const response = {
      import: {
        ...IMPORT,
        folders: [
          { ...IMPORT_FOLDER, state: "skipped" },
          { ...IMPORT_FOLDER, state: "quarantined" },
        ],
      },
    };

    expect(await issuesFrom(schema, response)).toBeUndefined();
    // The same payload against the schema this tool published before the fix.
    const closed = closedJsonSchema(importOutputSchema);
    expect(await issuesFrom(closed, response)).toBeDefined();
    expect(await issuesFrom(closed, { import: IMPORT })).toBeUndefined();
  });

  test("passes the published schema when an automation reports an action type added later", async () => {
    const tools = await listTools();
    const schema = tools.find((tool) => tool.name === "shipmail_get_automation")?.outputSchema;
    expect(schema).toBeDefined();
    if (schema === undefined) return;

    const response = {
      automation: {
        ...AUTOMATION,
        definition: {
          ...AUTOMATION.definition,
          actions: [{ type: "label_trigger_message", label_id: "lbl_1" }],
        },
      },
    };

    expect(await issuesFrom(schema, response)).toBeUndefined();
    const closed = closedJsonSchema(automationOutputSchema);
    expect(await issuesFrom(closed, response)).toBeDefined();
    expect(await issuesFrom(closed, { automation: AUTOMATION })).toBeUndefined();
  });
});

// Zod converts a discriminated union to `oneOf`, which insists exactly one branch match. The
// branches are told apart by the discriminator's `const`, so opening those constants without also
// relaxing the "exactly one" would reject a response for matching too many branches.
describe("opening a discriminated union", () => {
  const union = {
    oneOf: [
      {
        type: "object",
        properties: { type: { type: "string", const: "draft" }, instruction: { type: "string" } },
        required: ["type", "instruction"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: { type: { type: "string", const: "reply" }, instruction: { type: "string" } },
        required: ["type", "instruction"],
        additionalProperties: false,
      },
    ],
  } as const;

  test("accepts a payload that now matches several branches", async () => {
    const opened = openJsonSchemaObjects(union);
    expect(opened["oneOf"]).toBeUndefined();
    expect(Array.isArray(opened["anyOf"])).toBe(true);

    const payload = { type: "forward", instruction: "send it on" };
    expect(await issuesFrom(opened, payload)).toBeUndefined();
    // The same branches under `oneOf` reject it for matching both.
    expect(await issuesFrom({ oneOf: opened["anyOf"] }, payload)).toBeDefined();
  });
});

describe("openJsonSchemaObjects", () => {
  test("keeps the string type and description it found", () => {
    const opened = openJsonSchemaObjects({
      type: "string",
      enum: ["pending", "completed"],
      description: "Folder state.",
    });
    expect(opened).toEqual({ type: "string", description: "Folder state." });
  });

  test("leaves numeric and boolean literal sets alone", () => {
    const opened = openJsonSchemaObjects({
      type: "object",
      properties: {
        version: { type: "number", const: 2 },
        retries: { type: "integer", enum: [0, 1, 2] },
        enabled: { type: "boolean", const: true },
      },
    });
    expect(opened["properties"]).toEqual({
      version: { type: "number", const: 2 },
      retries: { type: "integer", enum: [0, 1, 2] },
      enabled: { type: "boolean", const: true },
    });
  });

  test("leaves a property legitimately named enum or const untouched", () => {
    const opened = openJsonSchemaObjects({
      type: "object",
      properties: {
        enum: { type: "string", enum: ["a"] },
        const: { type: "string", const: "b" },
      },
      required: ["enum", "const"],
    });
    expect(opened["properties"]).toEqual({ enum: { type: "string" }, const: { type: "string" } });
    expect(opened["required"]).toEqual(["enum", "const"]);
  });
});
