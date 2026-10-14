import { describe, expect, test } from "bun:test";

import { createShipmailMcpServer } from "../server.js";

describe("createShipmailMcpServer capabilities", () => {
  test("does not advertise list changes, so modern clients do not open subscriptions/listen", () => {
    const server = createShipmailMcpServer(
      { apiKey: "sm_test_capabilities", baseUrl: undefined },
      new Set(["shipmail_status", "shipmail_list_mailboxes"]),
    );
    const capabilities = server.server.getCapabilities();
    expect(capabilities.tools?.listChanged).toBe(false);
    expect(capabilities.resources?.listChanged ?? false).toBe(false);
    expect(capabilities.prompts?.listChanged ?? false).toBe(false);
  });
});
