import type {
  MailboxRule,
  MailboxRuleAction,
  MailboxRuleCondition,
  MailboxRuleFolder,
  MailboxRules,
  MethodOptions,
  ShipmailClient,
} from "shipmail";
import { ConflictError, NotFoundError, ValidationError } from "shipmail";

export type McpMailboxRule = MailboxRule & {
  readonly mailbox_id: string;
};

export type MutableMailboxRule = {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly match_mode: MailboxRule["match_mode"];
  readonly stop: boolean;
  readonly conditions: readonly MailboxRuleCondition[];
  readonly actions: readonly MailboxRuleAction[];
};

function collectCustomFolderIds(actions: readonly MailboxRuleAction[]): readonly string[] {
  const folderIds: string[] = [];
  for (const action of actions) {
    if (action.type === "move" && action.target.kind === "custom") {
      folderIds.push(action.target.folder_id);
    }
  }
  return folderIds;
}

export function assertCustomFoldersBelongToMailbox(
  folders: readonly MailboxRuleFolder[],
  actions: readonly MailboxRuleAction[],
): void {
  const allowed = new Set(
    folders.filter((folder) => folder.kind === "custom").map((folder) => folder.id),
  );
  for (const folderId of collectCustomFolderIds(actions)) {
    if (!allowed.has(folderId)) {
      throw new ValidationError(
        `Custom folder ${folderId} is not available on this mailbox. Call shipmail_list_mailbox_folders or shipmail_list_mailbox_rules first.`,
        {
          details: [{ field: "actions", message: "Target folder must belong to this mailbox." }],
        },
      );
    }
  }
}

export function toMcpMailboxRule(mailboxId: string, rule: MailboxRule): McpMailboxRule {
  return {
    ...rule,
    mailbox_id: mailboxId,
  };
}

export function withoutPositions(rules: readonly MailboxRule[]): MutableMailboxRule[] {
  return rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    match_mode: rule.match_mode,
    stop: rule.stop,
    conditions: rule.conditions,
    actions: rule.actions,
  }));
}

export function withPositions(rules: readonly MutableMailboxRule[]): MailboxRule[] {
  return rules.map((rule, position) => ({ ...rule, position }));
}

export function findRuleOrThrow(rules: readonly MailboxRule[], ruleId: string): MailboxRule {
  const rule = rules.find((entry) => entry.id === ruleId);
  if (!rule) {
    throw new NotFoundError(`Mailbox rule ${ruleId} was not found.`);
  }
  return rule;
}

export function assertExpectedPosition(
  rule: MailboxRule,
  expectedPosition: number | undefined,
): void {
  if (expectedPosition === undefined) return;
  if (rule.position !== expectedPosition) {
    throw new ConflictError(
      `Mailbox rule ${rule.id} changed (expected position ${expectedPosition}, found ${rule.position}). List the rule again before retrying.`,
    );
  }
}

export async function loadMailboxRules(
  client: ShipmailClient,
  mailboxId: string,
): Promise<MailboxRules> {
  return client.mailboxes.getRules(mailboxId);
}

export async function saveMailboxRules(
  client: ShipmailClient,
  mailboxId: string,
  rules: readonly MailboxRule[],
  options?: MethodOptions,
): Promise<MailboxRules> {
  return client.mailboxes.updateRules(mailboxId, { rules }, options);
}

export function insertRuleAt(
  existing: readonly MutableMailboxRule[],
  rule: MutableMailboxRule,
  position: number,
): MutableMailboxRule[] {
  const insertAt = Math.min(Math.max(position, 0), existing.length);
  return [...existing.slice(0, insertAt), rule, ...existing.slice(insertAt)];
}

export function replaceRuleAt(
  existing: readonly MutableMailboxRule[],
  rule: MutableMailboxRule,
  position: number,
): MutableMailboxRule[] {
  const insertAt = Math.min(Math.max(position, 0), existing.length);
  return [...existing.slice(0, insertAt), rule, ...existing.slice(insertAt)];
}
