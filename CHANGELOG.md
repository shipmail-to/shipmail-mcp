# Changelog

## 0.9.8 (2026-10-27)


### Features

* act on AgentMail's Claude reply findings
* **agents:** invite colleagues over the API and limit agent connections to mailboxes
* **mcp:** ship a Gemini CLI extension manifest
* **security:** publish security@shipmail.to as the security contact

## 0.9.7 (2026-10-23)


### Features

* add scoped agent mail review and reliable reply workflows
* **api:** one-off booking links in the API, SDKs, CLI and MCP
* **billing:** let trials test every feature with clear limits
* composer code formatting, paragraph spacing and the reply-draft lifecycle API
* domain health API, MCP tool and shareable health reports
* hero best-for line, no "own domain" copy, new welcome email steps
* **newsletters:** AI content check with human review, and subscriber domain re-check
* **newsletters:** reader engagement: tiers, engaged first, send to more, list cleanup, subject tests
* **newsletters:** summary email, subscriber page, issue timing and where an issue goes
* **newsletters:** website settings polish, and call a send a newsletter in the app and a post on the website
* **newsletters:** welcome sequences, newsletter websites, webmail button and Markdown input
* **webhooks:** authenticate mail a Shipmail mailbox sent, matched to its send record


### Bug Fixes

* analytics sync and attachment counts, MCP sender addresses, calendar import undo
* **sending:** suppression scopes, expiring soft-bounce pauses, signup bot protection

## 0.9.6 (2026-10-14)


### Features

* act on AgentMail's agent eval findings
* inbox search filters and webhook sender allowlist for agents
* **newsletters:** link analytics for email and the Atom feed
* reply_text and sender authentication for agents


### Bug Fixes

* MCP connects from LangChain JS, and a wrong 2FA code says so

## 0.9.5 (2026-10-10)


### Features

* **rules:** run rules on the inbox, Recipient contains, keep typed values
* **webhooks:** authenticate deliveries with an Authorization header or a Standard Webhooks secret

## 0.9.4 (2026-10-07)


### Bug Fixes

* **mcp:** describe Shipmail with the current hero copy in package listings

## 0.9.3 (2026-10-06)


### Features

* **agents:** hand Shipmail setup to an agent, owner pays
* forward mail for a selected alias


### Bug Fixes

* **domains:** ask for the four DNS records a connected domain needs

## 0.9.2 (2026-10-03)


### Features

* **api:** member roles and mailbox access in the API, SDKs, CLI and MCP (R3b-3)
* **calendar:** add reliable multi-calendar scheduling workspace
* complete newsletter workspace and audience tools
* **newsletters:** optional open and click tracking, clearer import drop zone
* **roles:** selected-access Admins manage forwarding, passwords and aliases of their mailboxes


### Bug Fixes

* preserve send and automation durability across retries

## 0.9.1 (2026-10-01)


### Bug Fixes

* **mcp:** open the plugin skill description with the homepage tagline

## 0.9.0 (2026-10-01)


### ⚠ BREAKING CHANGES

* remove the partner program

### Features

* **scheduled-send:** cutover tooling, legacy import, operator resolution and draft revisions (step 4b-2)


### Bug Fixes

* **mcp:** refresh the plugin listing copy and logo


### Code Refactoring

* remove the partner program

## 0.8.9 (2026-09-28)


### Features

* **admin:** abuse cases with lock, clear and terminate
* **webhooks:** limit a webhook to specific mailboxes or domains


### Bug Fixes

* harden SSRF and URL handling in discovery, redirects, S3 keys, import worker and MCP
* MCP text attachments in structured output, public origin for client-facing URLs
* package security and drift fixes from the audit

## 0.8.8 (2026-09-26)

### Bug Fixes

* centralize MCP tool guidance

## 0.8.7 (2026-09-24)


### Features

* **api:** save new-message drafts from the API and MCP

## 0.8.6 (2026-09-16)


### Bug Fixes

* **inbox:** keep a scheduled send's stored body when only its time changes

## 0.8.5 (2026-09-12)


### Bug Fixes

* **mcp:** let published output schemas accept enum values added later

## 0.8.4 (2026-09-11)


### Bug Fixes

* **import:** skip a source folder the server refuses instead of failing the import

## 0.8.3 (2026-09-11)


### Bug Fixes

* **mcp:** let tool output schemas accept fields added later

## 0.8.2 (2026-09-11)


### Features

* **api:** add conversation_id and deprecate thread_id

## 0.8.1 (2026-09-04)


### Features

* **newsletters:** add self-service migration center

## 0.8.0 (2026-09-03)




### Features

* **dashboard:** polish UX and add developer workspace


### Bug Fixes

* **spam:** reserve X-Spam-Flag header

## 0.7.15 (2026-08-31)


### Features

* **mailboxes:** add sender-filtered forwarding
* **mcp:** support reading inbox attachments

## 0.7.14 (2026-08-28)


### Bug Fixes

* **mcp:** restore public release sync

## 0.7.13 (2026-08-21)


### Features

* **mailboxes:** allow cross-domain catch-all

## 0.7.12 (2026-08-20)


### Features

* **mailboxes:** add mailbox delivery routing

## 0.7.11 (2026-08-19)


### Features

* **inbox:** recover away conversations and expose members over the API
* **webhooks:** emit member.away_updated

## 0.7.10 (2026-08-17)


### Bug Fixes

* **newsletters:** allow deleting domains used by history

## 0.7.9 (2026-08-15)


### Features

* retain and restore uploaded import sources


### Bug Fixes

* retain and resume uploaded imports

## 0.7.8 (2026-08-10)


### Bug Fixes

* **newsletters:** restore production media uploads

## 0.7.7 (2026-08-08)


### Features

* **newsletters:** accept inline HTML in block prose
* **newsletters:** add secure MCP media uploads

## 0.7.6 (2026-08-07)


### Bug Fixes

* **mcp:** let a multi-organization connection reach every organization

## 0.7.5 (2026-08-03)


### Features

* **calendar:** localize invitation emails

## 0.7.4 (2026-08-02)


### Features

* **mcp:** complete mailbox-rule management tools


### Bug Fixes

* **mcp:** advertise folder and inbox-rule management tools

## 0.7.3 (2026-08-02)


### Features

* **api:** add public automations API

## 0.7.2 (2026-07-30)


### Features

* **mcp:** add Cline and Smithery distributions
* **status:** launch independent Cloudflare status platform


### Bug Fixes

* **mcp:** use white-background distribution logos

## 0.7.1 (2026-07-30)


### Features

* **mcp:** add cross-platform plugin distribution


### Bug Fixes

* **mcp:** use Shipmail brand capitalization

## 0.7.0 (2026-07-29)


### ⚠ BREAKING CHANGES

* **mcp:** serve legacy clients again over stdio

### Bug Fixes

* **mcp:** serve legacy clients again over stdio

## 0.6.6 (2026-07-29)


### Bug Fixes

* **mcp:** start the server when capabilities cannot be fetched

## 0.6.5 (2026-07-29)


### Features

* **api:** expose inbound authentication results to clients

## 0.6.4 (2026-07-29)


### Features

* **api:** add message analytics sync endpoint

## 0.6.3 (2026-07-29)


### Features

* **sdk:** support multiple newsletter sender identities

## 0.6.2 (2026-07-29)


### Features

* product-led distribution tools (calculator, migration planner, shareable health reports, agent starter kit)

## 0.6.1 (2026-07-29)


### Features

* **api:** expose feed canonical URL and entry limit

## 0.6.0 (2026-07-28)


### ⚠ BREAKING CHANGES

* **mcp:** MCP clients must support protocol version 2026-07-28; legacy initialize traffic is rejected.

### Features

* **mcp:** adopt protocol 2026-07-28
* **newsletters:** add safe feed token lifecycle

## 0.5.10 (2026-07-28)


### Bug Fixes

* **seo:** align public facts and discovery surfaces

## 0.5.9 (2026-07-27)


### Features

* **newsletters:** publish an audience as an opt-in Atom feed

## 0.5.8 (2026-07-27)


### Features

* **newsletters:** plain styling mode and code-view round-trip fixes

## 0.5.7 (2026-07-27)


### Features

* **assistant:** manage inbox rules by name and expose rule disposition in the API

## 0.5.6 (2026-07-26)


### Features

* **mcp:** list resources across organizations

## 0.5.5 (2026-07-26)


### Features

* **mcp:** let one connection reach several organizations

## 0.5.4 (2026-07-25)


### Bug Fixes

* **mcp:** repair custom consent flow

## 0.5.3 (2026-07-25)


### Bug Fixes

* **mcp:** widen consent, redesign resource limits, drop recipient policy

## 0.5.2 (2026-07-25)


### Bug Fixes

* **mcp:** stop release PRs failing on server-card formatting

## 0.5.1 (2026-07-25)


### Bug Fixes

* **sdk:** drop bun export conditions that point at unpublished source

## 0.5.0 (2026-07-25)


### ⚠ BREAKING CHANGES

* **mcp:** add capability-complete connector controls

### Features

* **mcp:** add capability-complete connector controls

## 0.4.0 (2026-07-23)


### ⚠ BREAKING CHANGES

* **assistant:** replace Agent OS with admin-only AI assistant

### Features

* **assistant:** replace Agent OS with admin-only AI assistant

## 0.3.4 (2026-07-21)


### Features

* **mcp:** OAuth sign-in for the hosted MCP endpoint

## 0.3.3 (2026-07-20)


### Features

* **api:** add agent-safe reply queue workflows
* **mcp:** hosted remote MCP endpoint at /api/mcp


### Bug Fixes

* **mcp:** return summaries from the inbox message list tool

## 0.3.2 (2026-07-19)


### Features

* **newsletters:** add team collaboration

## 0.3.1 (2026-07-17)


### Features

* **import:** add Infomaniak, OVHcloud, and Gandi migrations
* improve AI agent readiness

## 0.3.0 (2026-07-16)




### Features

* **partner:** complete embedded mailbox credentials

## 0.2.10 (2026-07-14)


### Features

* **api:** expose conferencing_provider on booking pages
* **partner:** add invite-only reseller beta

## 0.2.9 (2026-07-13)


### Features

* add api mailbox infrastructure foundations
* **api:** automate domain and mailbox provisioning
* **mailboxes:** add verified forwarding and partner pilot

## 0.2.8 (2026-07-12)


### Features

* **calendar:** complete launch follow-ups
* **webhooks:** add delivery detail and failed-delivery replay tools
* **sandbox:** add synthetic send outcomes and fake inbound message tooling
* **mailboxes:** add suspend and resume tools

## 0.2.7 (2026-07-07)


### Features

* calendar — events, invites, booking links, API, conferencing

## 0.2.6 (2026-07-06)


### Features

* add newsletter audience resubscribe

## 0.2.5 (2026-07-06)


### Features

* edit future scheduled newsletters

## 0.2.4 (2026-07-05)


### Features

* **newsletters:** block insert seams, hover-reachable rail, and button alignment

## 0.2.3 (2026-07-05)


### Bug Fixes

* **newsletters:** address review findings

## 0.2.2 (2026-07-05)


### Features

* **newsletters:** full-page block editor with blocks-first API

## 0.2.1 (2026-07-03)


### Features

* **newsletters:** add API and SDK support

## 0.2.0 (2026-07-02)


### ⚠ BREAKING CHANGES

* **newsletters:** cut over broadcasts to newsletters

### Features

* programmatic audience sync for broadcasts (API, SDK, MCP, CLI)


### Code Refactoring

* **newsletters:** cut over broadcasts to newsletters

## 0.1.9 - 2026-06-20

- Add the public npm trusted-publishing workflow and provenance.
- Enrich public directory metadata for discovery.
- Align the runtime, package, and directory versions.

## 0.1.7 (2026-06-19)


### Bug Fixes

* **seo:** improve MCP source discoverability
* **shipmail-mcp:** enable MCP registry publishing

## 0.1.6 (2026-06-19)


### Bug Fixes

* **shipmail-mcp:** keep server metadata version aligned

## 0.1.5 (2026-06-19)


### Bug Fixes

* **shipmail-mcp:** trigger public metadata release

## 0.1.4 - 2026-06-14

- Expose inbox message bodies through the MCP tools that read mailbox inbox messages.

## 0.1.3 - 2026-06-13

- Add agent-native email documentation, AI-visibility support content, and mailbox import coverage.

## 0.1.2 - 2026-05-15

- Add billing and domain setup improvements used by the public Shipmail API surface.

## 0.1.1 - 2026-05-09

- Document npm release automation for the MCP package.
