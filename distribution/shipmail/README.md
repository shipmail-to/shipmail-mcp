# Shipmail for Claude

Shipmail connects Claude to custom-domain email and calendar workflows through
the hosted MCP server at
`https://shipmail.to/api/mcp`. Install this directory as a Claude plugin, then
connect your Shipmail account with OAuth when Claude prompts you.

Start with the read-and-draft connection profile for inbox triage, search,
calendar availability, and drafting messages. Grant sending or administration
permissions only when you need those actions. Ask Claude to use only the
Shipmail tools needed for your task.

Try one of these prompts:

- "List my Shipmail mailboxes, then summarize unread messages in support@example.com."
- "Draft a reply to the latest invoice question, but do not send it."
- "Check my Shipmail calendar availability for next Tuesday afternoon."

Information fetched by selected tools, including email, calendar, and
attachment content, is returned to Claude for the current task. When you
approve a message, event, or account change, its details are sent to Shipmail
through the selected tool. User-approved local email attachments and newsletter
media may go directly to one-time storage upload URLs returned by Shipmail;
Claude then supplies the resulting attachment or media reference to the
relevant tool.

Shipmail keeps data while your account is active. After account deletion, it is
deleted within 30 days; backups may retain it for up to 90 days.

This plugin contains connection settings and operating guidance only. It has no
bundled executables, hooks, or background services. Read the
[MCP documentation](https://shipmail.to/docs/mcp),
[privacy policy](https://shipmail.to/privacy), and
[terms](https://shipmail.to/terms). For help, contact
[Shipmail support](https://shipmail.to/support).
