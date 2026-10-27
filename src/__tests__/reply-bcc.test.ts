import { describe, expect, test } from "bun:test";

import {
  replyToInboxMessageInputSchema,
  replyToInboxThreadInputSchema,
  replyToMessageInputSchema,
  replyToThreadInputSchema,
} from "../schemas";

const body = {
  to: [{ address: "customer@example.com" }],
  bcc: [{ address: "manager@example.com" }],
  text: "On track.",
};

describe("reply tools keep Bcc", () => {
  test.each([
    ["shipmail_reply_to_message", replyToMessageInputSchema, { id: "msg_123" }],
    ["shipmail_reply_to_thread", replyToThreadInputSchema, { id: "thd_123", mailbox_id: "mbx_1" }],
    [
      "shipmail_reply_to_inbox_message",
      replyToInboxMessageInputSchema,
      { id: "mbx_1", message_id: "eml_1" },
    ],
    [
      "shipmail_reply_to_inbox_thread",
      replyToInboxThreadInputSchema,
      { id: "mbx_1", thread_id: "thd_1" },
    ],
  ] as const)("%s", (_name, schema, target) => {
    const parsed = schema.parse({ ...target, ...body });
    expect(parsed.bcc).toEqual([{ address: "manager@example.com" }]);
    const tooMany = Array.from({ length: 50 }, (_, i) => ({ address: `r${i}@example.com` }));
    expect(schema.safeParse({ ...target, ...body, cc: tooMany }).success).toBe(false);
  });
});
