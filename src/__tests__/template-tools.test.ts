import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { ShipmailClient } from "shipmail";

import { getMcpCapability } from "../capabilities.js";
import {
  renderedTemplateOutputSchema,
  sendMessageInputSchema,
  templateOutputSchema,
  updateTemplateInputSchema,
} from "../schemas.js";
import { registerTools } from "../tools.js";

const TEMPLATE = {
  object: "template",
  id: "tpl_abc",
  name: "Welcome",
  subject: "Hi {{name}}",
  html: "<p>Hi {{name}}</p>",
  text: null,
  fallbacks: {},
  variables: [{ key: "name", required: true, fallback: null }],
  published_version: 1,
  has_unpublished_changes: false,
  created_at: "2026-10-27T10:00:00.000Z",
  updated_at: "2026-10-27T10:00:00.000Z",
} as const;

const RENDERED = {
  object: "rendered_template",
  template_id: "tpl_abc",
  version: null,
  subject: "Hi Ada",
  html: "<p>Hi Ada</p>",
  text: null,
} as const;

// The request is what matters here; the response shape is covered by the message tool tests.
const MESSAGE = { object: "message", id: "msg_1" } as const;

type Captured = {
  readonly method: string | undefined;
  readonly path: string;
  readonly body: unknown;
};

async function callTool(name: string, args: Record<string, unknown>, response: unknown) {
  const requests: Captured[] = [];
  const fetchImpl: typeof fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        method: init?.method,
        path: new URL(String(input)).pathname,
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      return response === null ? new Response(null, { status: 204 }) : Response.json(response);
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

describe("template capabilities", () => {
  test("preview is a read, delete is destructive, and all sit in the templates group", () => {
    expect(getMcpCapability("shipmail_preview_template")?.effect).toBe("read");
    expect(getMcpCapability("shipmail_delete_template")?.effect).toBe("destructive");
    expect(getMcpCapability("shipmail_publish_template")?.effect).toBe("local_write");
    expect(getMcpCapability("shipmail_restore_template_version")?.permissionGroup).toBe(
      "templates",
    );
  });
});

describe("sendMessageInputSchema with a template", () => {
  const base = { mailbox_id: "mbx_1", to: ["ada@example.com"] };

  test("accepts a template without subject or body", () => {
    expect(
      sendMessageInputSchema.safeParse({
        ...base,
        template: { id: "tpl_abc", variables: { name: "Ada" } },
      }).success,
    ).toBe(true);
  });

  test("rejects a template together with subject, html or text", () => {
    for (const extra of [{ subject: "Hi" }, { html: "<p>x</p>" }, { text: "x" }]) {
      expect(
        sendMessageInputSchema.safeParse({ ...base, ...extra, template: { id: "tpl_abc" } })
          .success,
      ).toBe(false);
    }
  });

  test("still requires a subject and a body without a template", () => {
    expect(sendMessageInputSchema.safeParse({ ...base, text: "x" }).success).toBe(false);
    expect(sendMessageInputSchema.safeParse({ ...base, subject: "Hi" }).success).toBe(false);
  });
});

describe("updateTemplateInputSchema", () => {
  test("requires a field to change and allows null bodies", () => {
    expect(updateTemplateInputSchema.safeParse({ id: "tpl_abc" }).success).toBe(false);
    expect(updateTemplateInputSchema.safeParse({ id: "tpl_abc", text: null }).success).toBe(true);
  });
});

describe("template tools", () => {
  test("shipmail_send_message forwards the template and no subject", async () => {
    const { requests } = await callTool(
      "shipmail_send_message",
      {
        mailbox_id: "mbx_1",
        to: ["ada@example.com"],
        template: { id: "tpl_abc", version: 2, variables: { name: "Ada" } },
      },
      MESSAGE,
    );
    expect(requests).toEqual([
      {
        method: "POST",
        path: "/api/v1/messages",
        body: {
          mailbox_id: "mbx_1",
          to: ["ada@example.com"],
          template: { id: "tpl_abc", version: 2, variables: { name: "Ada" } },
        },
      },
    ]);
  });

  test("shipmail_preview_template renders through the API", async () => {
    const { result, requests } = await callTool(
      "shipmail_preview_template",
      { id: "tpl_abc", variables: { name: "Ada" } },
      RENDERED,
    );
    expect(result.isError).toBeFalsy();
    expect(renderedTemplateOutputSchema.parse(result.structuredContent)).toEqual({
      rendered_template: RENDERED,
    });
    expect(requests).toEqual([
      {
        method: "POST",
        path: "/api/v1/templates/tpl_abc/render",
        body: { variables: { name: "Ada" } },
      },
    ]);
  });

  test("shipmail_update_template sends only the changed fields", async () => {
    const { result, requests } = await callTool(
      "shipmail_update_template",
      { id: "tpl_abc", subject: "Hello {{name}}", text: null },
      TEMPLATE,
    );
    expect(result.isError).toBeFalsy();
    expect(templateOutputSchema.parse(result.structuredContent).template.id).toBe("tpl_abc");
    expect(requests).toEqual([
      {
        method: "PATCH",
        path: "/api/v1/templates/tpl_abc",
        body: { subject: "Hello {{name}}", text: null },
      },
    ]);
  });

  test("shipmail_restore_template_version posts to the version", async () => {
    const { requests } = await callTool(
      "shipmail_restore_template_version",
      { id: "tpl_abc", version: 1 },
      TEMPLATE,
    );
    expect(requests.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: "POST", path: "/api/v1/templates/tpl_abc/versions/1/restore" },
    ]);
  });

  test("shipmail_delete_template acknowledges the deletion", async () => {
    const { result, requests } = await callTool(
      "shipmail_delete_template",
      { id: "tpl_abc" },
      null,
    );
    expect(result.structuredContent).toEqual({ result: { ok: true, id: "tpl_abc" } });
    expect(requests[0]?.method).toBe("DELETE");
  });
});
