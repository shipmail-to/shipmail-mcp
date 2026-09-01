import { describe, expect, test } from "bun:test";

import {
  getAllowedMcpToolNames,
  MCP_CAPABILITIES,
  MCP_HOSTED_OAUTH_PERMISSION_GROUP_NAMES,
} from "../capabilities";

describe("MCP transport capability derivation", () => {
  test("offers raw staged uploads to local clients without exposing the hosted review card", () => {
    const hosted = getAllowedMcpToolNames(["messages:send"], "directApiKeyHttp");
    const stdio = getAllowedMcpToolNames(["messages:send"], "stdio");

    expect(hosted).toContain("shipmail_send_message");
    expect(hosted).toContain("shipmail_compose_message_with_file");
    expect(hosted).toContain("shipmail_prepare_staged_attachment_upload");
    expect(stdio).toContain("shipmail_send_message");
    expect(stdio).not.toContain("shipmail_compose_message_with_file");
    expect(stdio).toContain("shipmail_prepare_staged_attachment_upload");
  });

  test("offers prepared newsletter uploads without exposing the hosted file card to stdio", () => {
    const hosted = getAllowedMcpToolNames(["newsletters:write"], "directApiKeyHttp");
    const stdio = getAllowedMcpToolNames(["newsletters:write"], "stdio");

    expect(hosted).toContain("shipmail_upload_newsletter_asset_with_file");
    expect(hosted).toContain("shipmail_prepare_newsletter_asset_upload");
    expect(stdio).not.toContain("shipmail_upload_newsletter_asset_with_file");
    expect(stdio).toContain("shipmail_prepare_newsletter_asset_upload");
  });

  test("always exposes only the public status tool without granted scopes", () => {
    expect([...getAllowedMcpToolNames([], "stdio")]).toEqual(["shipmail_status"]);
  });

  test("maps dedicated rule scopes to persistent least-privilege tools", () => {
    const read = getAllowedMcpToolNames(["mailbox_rules:read"], "hostedOAuth");
    const write = getAllowedMcpToolNames(["mailbox_rules:write"], "hostedOAuth");
    const organize = getAllowedMcpToolNames(["messages:write"], "hostedOAuth");

    expect(read).toContain("shipmail_list_mailbox_rules");
    expect(read).toContain("shipmail_get_mailbox_rule");
    expect(read).not.toContain("shipmail_create_mailbox_rule");
    expect(write).toContain("shipmail_create_mailbox_rule");
    expect(write).toContain("shipmail_update_mailbox_rule");
    expect(write).toContain("shipmail_delete_mailbox_rule");
    expect(write).not.toContain("shipmail_get_mailbox_rule");
    expect(write).not.toContain("shipmail_update_mailbox");
    expect(organize).toContain("shipmail_create_mailbox_folder");
    expect(organize).toContain("shipmail_update_mailbox_folder");
    expect(organize).toContain("shipmail_delete_mailbox_folder");
    expect(organize).not.toContain("shipmail_create_mailbox");
    expect(
      MCP_CAPABILITIES.find((capability) => capability.toolName === "shipmail_delete_mailbox_rule"),
    ).toMatchObject({
      permissionGroup: "mailbox_rules",
      effect: "destructive",
      duration: "persistent",
    });
    expect(
      MCP_CAPABILITIES.find(
        (capability) => capability.toolName === "shipmail_create_mailbox_folder",
      ),
    ).toMatchObject({
      permissionGroup: "mail_organize",
      requiredScope: "messages:write",
    });
  });

  test("marks irreversible feed lifecycle operations as destructive", () => {
    for (const toolName of ["shipmail_rotate_audience_feed", "shipmail_revoke_audience_feed"]) {
      expect(MCP_CAPABILITIES.find((capability) => capability.toolName === toolName)).toMatchObject(
        {
          effect: "destructive",
        },
      );
    }
  });

  test("classifies inbox attachment reads as read-only", () => {
    expect(
      MCP_CAPABILITIES.find(
        (capability) => capability.toolName === "shipmail_read_mailbox_inbox_attachment",
      ),
    ).toMatchObject({
      effect: "read",
      idempotency: "none",
      auditAction: null,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    });
  });

  test("derives hosted OAuth permission groups from the hosted tool catalog", () => {
    expect(MCP_HOSTED_OAUTH_PERMISSION_GROUP_NAMES).not.toContain("partner_admin");
    for (const group of MCP_HOSTED_OAUTH_PERMISSION_GROUP_NAMES) {
      expect(
        MCP_CAPABILITIES.some(
          (capability) => capability.permissionGroup === group && capability.transports.hostedOAuth,
        ),
      ).toBe(true);
    }
  });
});
