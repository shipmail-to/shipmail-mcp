import { existsSync } from "node:fs";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, test } from "bun:test";

import { MCP_TOOL_NAMES } from "../capabilities.js";

const EXPECTED_FOLDER_AND_RULE_TOOLS = [
  "shipmail_create_mailbox_folder",
  "shipmail_update_mailbox_folder",
  "shipmail_delete_mailbox_folder",
  "shipmail_list_mailbox_rules",
  "shipmail_get_mailbox_rule",
  "shipmail_create_mailbox_rule",
  "shipmail_update_mailbox_rule",
  "shipmail_delete_mailbox_rule",
] as const;

const REQUIRED_INPUT_KEYS: Readonly<
  Record<(typeof EXPECTED_FOLDER_AND_RULE_TOOLS)[number], readonly string[]>
> = {
  shipmail_create_mailbox_folder: ["id", "name", "parent_id"],
  shipmail_update_mailbox_folder: ["id", "folder_id", "name"],
  shipmail_delete_mailbox_folder: ["id", "folder_id"],
  shipmail_list_mailbox_rules: ["id"],
  shipmail_get_mailbox_rule: ["id", "rule_id"],
  shipmail_create_mailbox_rule: ["id", "name", "conditions", "actions"],
  shipmail_update_mailbox_rule: ["id", "rule_id"],
  shipmail_delete_mailbox_rule: ["id", "rule_id"],
};

const packageRoot = join(import.meta.dir, "../..");
const builtEntry = join(packageRoot, "dist/index.js");

describe("built MCP server tools/list", () => {
  test("advertises folder and rule management tools with complete schemas", async () => {
    expect(existsSync(builtEntry)).toBe(true);

    // An invalid key makes capability discovery fail closed to the full local catalog, which is
    // what tools/list must publish for this package version. The hosted route still filters by
    // connection permissions separately.
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [builtEntry],
      env: {
        ...process.env,
        SHIPMAIL_API_KEY: "sm_test_tools_list_integration",
        SHIPMAIL_BASE_URL: "https://shipmail.to/api/v1",
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "built-tools-list", version: "0.0.0" });

    await client.connect(transport);
    try {
      const listed = await client.listTools();
      const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));

      expect([...byName.keys()].sort()).toEqual([...MCP_TOOL_NAMES].sort());

      for (const toolName of EXPECTED_FOLDER_AND_RULE_TOOLS) {
        const tool = byName.get(toolName);
        expect(tool).toBeDefined();
        if (!tool) continue;
        expect(tool.description?.length ?? 0).toBeGreaterThan(20);
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema?.type).toBe("object");
        const properties = tool.inputSchema?.properties ?? {};
        for (const key of REQUIRED_INPUT_KEYS[toolName]) {
          expect(properties).toHaveProperty(key);
        }
        expect(tool.outputSchema).toBeDefined();
        expect(tool.outputSchema?.type).toBe("object");
      }

      expect(byName.has("shipmail_get_mailbox_rules")).toBe(false);
      expect(byName.has("shipmail_set_mailbox_rules")).toBe(false);
    } finally {
      await client.close();
    }
  }, 60_000);
});
