import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { z } from "zod/v4";

import { MCP_TOOL_NAMES } from "../capabilities.js";
import { createShipmailMcpServer } from "../server.js";

const apiKey = process.env["SHIPMAIL_API_KEY"];
const mailboxId = process.env["SHIPMAIL_SANDBOX_MAILBOX_ID"];
const baseUrl = process.env["SHIPMAIL_BASE_URL"] ?? "https://shipmail.to/api/v1";
const runLive = Boolean(apiKey?.startsWith("sm_test_") && mailboxId?.startsWith("mbx_"));

const folderSchema = z.object({
  folder: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
});
const foldersSchema = z.object({
  folders: z.object({
    data: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
      }),
    ),
  }),
});
const ruleSchema = z.object({
  rule: z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    enabled: z.boolean(),
  }),
});
const rulesSchema = z.object({
  rules: z.object({
    rules: z.array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
      }),
    ),
  }),
});
const ackSchema = z.object({
  result: z.object({
    ok: z.literal(true),
    id: z.string().min(1),
  }),
});

async function connectSandboxClient(): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  if (!apiKey) {
    throw new Error("SHIPMAIL_API_KEY is required for sandbox integration.");
  }
  const server = createShipmailMcpServer(
    { apiKey, baseUrl, organizationId: undefined },
    new Set(MCP_TOOL_NAMES),
  );
  const client = new Client({ name: "folder-rule-sandbox", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return {
    client,
    close: async () => {
      await Promise.all([client.close(), server.close()]);
    },
  };
}

async function callTool<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError ?? false).toBe(false);
  return schema.parse(result.structuredContent);
}

describe.skipIf(!runLive)("sandbox folder and rule CRUD via MCP", () => {
  test("creates, lists, updates, and deletes a custom folder and inbox rule", async () => {
    if (!mailboxId) {
      throw new Error("SHIPMAIL_SANDBOX_MAILBOX_ID is required.");
    }

    const suffix = Date.now().toString(36);
    const folderName = `mcp-folder-${suffix}`;
    const renamedFolderName = `${folderName}-renamed`;
    const ruleName = `mcp-rule-${suffix}`;
    const renamedRuleName = `${ruleName}-renamed`;

    const { client, close } = await connectSandboxClient();
    try {
      const createdFolder = await callTool(
        client,
        "shipmail_create_mailbox_folder",
        { id: mailboxId, name: folderName, parent_id: null },
        folderSchema,
      );
      expect(createdFolder.folder.name).toBe(folderName);

      const listedFolders = await callTool(
        client,
        "shipmail_list_mailbox_folders",
        { id: mailboxId },
        foldersSchema,
      );
      expect(
        listedFolders.folders.data.some((folder) => folder.id === createdFolder.folder.id),
      ).toBe(true);

      const updatedFolder = await callTool(
        client,
        "shipmail_update_mailbox_folder",
        {
          id: mailboxId,
          folder_id: createdFolder.folder.id,
          name: renamedFolderName,
        },
        folderSchema,
      );
      expect(updatedFolder.folder.name).toBe(renamedFolderName);

      const createdRule = await callTool(
        client,
        "shipmail_create_mailbox_rule",
        {
          id: mailboxId,
          name: ruleName,
          enabled: true,
          match_mode: "all",
          stop: false,
          conditions: [{ type: "subject_contains", value: `mcp-${suffix}` }],
          actions: [
            { type: "move", target: { kind: "custom", folder_id: createdFolder.folder.id } },
          ],
        },
        ruleSchema,
      );
      expect(createdRule.rule.name).toBe(ruleName);

      const listedRules = await callTool(
        client,
        "shipmail_list_mailbox_rules",
        { id: mailboxId },
        rulesSchema,
      );
      expect(listedRules.rules.rules.some((rule) => rule.id === createdRule.rule.id)).toBe(true);

      const fetchedRule = await callTool(
        client,
        "shipmail_get_mailbox_rule",
        { id: mailboxId, rule_id: createdRule.rule.id },
        ruleSchema,
      );
      expect(fetchedRule.rule.id).toBe(createdRule.rule.id);
      expect(fetchedRule.rule.name).toBe(ruleName);

      const updatedRule = await callTool(
        client,
        "shipmail_update_mailbox_rule",
        {
          id: mailboxId,
          rule_id: createdRule.rule.id,
          name: renamedRuleName,
          enabled: false,
        },
        ruleSchema,
      );
      expect(updatedRule.rule.name).toBe(renamedRuleName);
      expect(updatedRule.rule.enabled).toBe(false);

      const deletedRule = await callTool(
        client,
        "shipmail_delete_mailbox_rule",
        { id: mailboxId, rule_id: createdRule.rule.id },
        ackSchema,
      );
      expect(deletedRule.result.id).toBe(createdRule.rule.id);

      const deletedFolder = await callTool(
        client,
        "shipmail_delete_mailbox_folder",
        { id: mailboxId, folder_id: createdFolder.folder.id },
        ackSchema,
      );
      expect(deletedFolder.result.id).toBe(createdFolder.folder.id);
    } finally {
      await close();
    }
  }, 120_000);
});
