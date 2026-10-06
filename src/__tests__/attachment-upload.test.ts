import vm from "node:vm";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { ShipmailClient } from "shipmail";

import { ATTACHMENT_COMPOSER_HTML } from "../attachment-component.js";
import { stagedAttachmentUploadPreparationOutputSchema } from "../schemas.js";
import { registerTools } from "../tools.js";

type TestFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function buildPair(testFetch: TestFetch) {
  const fetchImpl = Object.assign(testFetch, {
    preconnect() {},
  });
  const shipmail = new ShipmailClient({
    apiKey: "sk_test",
    baseUrl: "https://shipmail.to/api/v1",
    maxRetries: 0,
    fetch: fetchImpl,
  });
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, shipmail, new Set(["shipmail_prepare_staged_attachment_upload"]));
  const client = new Client({ name: "test-client", version: "0.0.0" });
  return { server, client };
}

async function connectPair(server: McpServer, client: Client): Promise<void> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
}

describe("local-file attachment upload", () => {
  test("returns the one-time upload contract to the MCP client and the review component", async () => {
    const uploadUrl = "https://shipmail.to/api/v1/staged-attachment-uploads/upload_token";
    const { server, client } = buildPair(async (input, init) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/v1/mailboxes/mbx_123/staged-attachment-upload-tokens");
      expect(init?.method).toBe("POST");
      return Response.json({
        object: "staged_attachment_upload",
        mailbox_id: "mbx_123",
        filename: "invoice.pdf",
        content_type: "application/pdf",
        size: 123,
        sha256: "a".repeat(64),
        upload_url: uploadUrl,
        expires_at: "2026-07-25T22:05:00.000Z",
      });
    });
    await connectPair(server, client);

    const tools = await client.listTools();
    const uploadTool = tools.tools.find(
      (tool) => tool.name === "shipmail_prepare_staged_attachment_upload",
    );
    expect(uploadTool).toBeDefined();
    expect(uploadTool?._meta?.["openai/visibility"]).toBeUndefined();

    const result = await client.callTool({
      name: "shipmail_prepare_staged_attachment_upload",
      arguments: {
        mailbox_id: "mbx_123",
        filename: "invoice.pdf",
        content_type: "application/pdf",
        size: 123,
        sha256: "a".repeat(64),
      },
    });

    expect(result.isError).toBeFalsy();
    const output = stagedAttachmentUploadPreparationOutputSchema.parse(result.structuredContent);
    expect(output.prepared_upload).toMatchObject({
      upload_url: uploadUrl,
      upload_method: "POST",
    });
    expect(result._meta).toMatchObject({ upload_url: uploadUrl });
  });
});

describe("attachment composer retry", () => {
  type SendInput = {
    readonly mailbox_id: string;
    readonly to: readonly { readonly address: string }[];
    readonly subject: string;
    readonly text: string;
    readonly scheduled_at?: string;
    readonly staged_attachment_ids: readonly string[];
    readonly idempotency_key: string;
  };

  function isSendInput(value: unknown): value is SendInput {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const input = value as Record<string, unknown>;
    return (
      typeof input.mailbox_id === "string" &&
      typeof input.subject === "string" &&
      typeof input.text === "string" &&
      typeof input.idempotency_key === "string" &&
      Array.isArray(input.to) &&
      Array.isArray(input.staged_attachment_ids)
    );
  }

  for (const scenario of [
    {
      name: "a lost response",
      firstResult: "throw",
      scheduledAt: undefined,
      pickerDuringSend: false,
    },
    {
      name: "an error tool result for a scheduled send",
      firstResult: "tool_error",
      scheduledAt: "2026-08-01T09:00:00.000Z",
      pickerDuringSend: false,
    },
    {
      name: "a picker result that arrives after a lost response",
      firstResult: "throw",
      scheduledAt: undefined,
      pickerDuringSend: true,
    },
  ] as const) {
    test(`reuses its staged attachment and idempotency key after ${scenario.name}`, async () => {
      const script = ATTACHMENT_COMPOSER_HTML.match(/<script>([\s\S]*)<\/script>/)?.[1];
      if (!script) throw new Error("Attachment composer script is missing.");

      const listeners = new Map<string, () => Promise<void>>();
      const elements = new Map(
        ["file", "to", "subject", "delivery", "submit", "change", "status"].map((id) => [
          id,
          {
            textContent: "",
            className: "",
            hidden: false,
            disabled: false,
            addEventListener: (_name: string, listener: () => Promise<void>) =>
              listeners.set(id, listener),
          },
        ]),
      );
      const sent: SendInput[] = [];
      let prepared = 0;
      let uploads = 0;
      let sendAttempts = 0;
      const replacementFile = [{ file_id: "different_file", file_name: "other.pdf" }];
      let resolvePicker: ((files: typeof replacementFile) => void) | undefined;
      const bridge = {
        toolInput: {
          mailbox_id: "mbx_123",
          to: [{ address: "to@example.com" }],
          subject: "Invoice",
          text: "Attached",
          ...(scenario.scheduledAt ? { scheduled_at: scenario.scheduledAt } : {}),
          file: {
            file_id: "file_123",
            file_name: "invoice.pdf",
            mime_type: "application/pdf",
            download_url: "https://files.test/invoice",
          },
        },
        callTool: async (name: string, args: unknown) => {
          if (name === "shipmail_prepare_staged_attachment_upload") {
            prepared++;
            return { _meta: { upload_url: "https://uploads.test/one" } };
          }
          if (name !== "shipmail_send_message" || !isSendInput(args)) {
            throw new Error("Unexpected attachment composer tool call.");
          }
          sent.push(args);
          sendAttempts++;
          if (sendAttempts === 1) {
            if (scenario.firstResult === "throw") throw new Error("response_lost_after_acceptance");
            return { isError: true };
          }
          return { structuredContent: { message: { id: "msg_123" } } };
        },
        selectFiles: async () => {
          if (!scenario.pickerDuringSend) return replacementFile;
          return new Promise<typeof replacementFile>((resolve) => {
            resolvePicker = resolve;
          });
        },
      };
      const bytes = new Uint8Array([1, 2, 3]).buffer;
      const context = vm.createContext({
        window: { openai: bridge },
        document: { getElementById: (id: string) => elements.get(id) },
        fetch: async (url: string, init?: RequestInit) => {
          if (url === "https://files.test/invoice")
            return new Response(bytes, { headers: { "content-type": "application/pdf" } });
          expect(url).toBe("https://uploads.test/one");
          expect(init?.method).toBe("POST");
          uploads++;
          return Response.json({ id: "sat_123" });
        },
        crypto: globalThis.crypto,
        Uint8Array,
        Array,
        Object,
        Date,
        Error,
      });
      vm.runInContext(script, context);

      const submit = listeners.get("submit");
      const change = listeners.get("change");
      if (!submit || !change) throw new Error("Attachment composer controls are missing.");
      const changing = scenario.pickerDuringSend ? change() : null;
      if (changing) await Promise.resolve();
      await submit();
      // The file picker cannot replace an uncertain request with a new key.
      expect(elements.get("change")?.disabled).toBe(true);
      expect(elements.get("submit")?.textContent).toBe(
        scenario.scheduledAt ? "Check scheduled result" : "Check send result",
      );
      if (changing) {
        if (!resolvePicker) throw new Error("File picker did not start.");
        resolvePicker(replacementFile);
        await changing;
      } else {
        await change();
      }
      await submit();

      expect(prepared).toBe(1);
      expect(uploads).toBe(1);
      expect(sent).toHaveLength(2);
      expect(sent[0]).toEqual(sent[1]);
      expect(sent[0]).toMatchObject({
        staged_attachment_ids: ["sat_123"],
        idempotency_key: expect.stringMatching(/^mcp_app_/),
      });
    });
  }
});
