# TraceGuard - project instructions for Claude Code
## What this is
Forge app for Atlassian Codegeist 2026 (category: Apps for Specialized Industries).
TraceGuard builds a requirement -> implementation -> test traceability matrix from Jira,
detects audit gaps, explains them, and writes audit packs to Confluence.
## Stack
- Atlassian Forge, JavaScript (ES modules), Node 22+ runtime.
- UI: UI Kit only (@forge/react + @forge/bridge). No Custom UI.
- Backend: @forge/resolver, @forge/api, @forge/kvs, @forge/sql, @forge/llm.
- Rovo: rovo:agent + action modules. Teamwork Graph via api.asApp().requestTeamworkGraph.
## Commands
- npm test
-> unit tests (node --test), must stay green
- forge lint
-> manifest + code checks
- forge deploy
-> deploy to development
- forge install --upgrade -> needed after scope/module changes
- forge tunnel
-> run by the human in a separate terminal, never by Claude
## Rules
- ALWAYS use the Forge MCP tools to check current Forge docs before using a module or API.
- Jira search: POST /rest/api/3/search/jql with nextPageToken.
Never use /rest/api/3/search (it was removed).
- User-facing reads (resolvers, Rovo actions): api.asUser().
Triggers and scheduled jobs: api.asApp().
- Never trust Rovo action inputs for authorization; check permissions with the user's context.
- Gap rules live in src/engine/ as pure functions with unit tests. No API calls in src/engine/.
- Every external call: check res.ok, log with prefix "[TG]", throw a clear Error.
- No secrets in code or git. Config via Forge variables (process.env) or KVS settings.
- Keep functions small. Prefer clear names over comments. Explain changes briefly.
- Do not change manifest scopes without telling me (it forces a re-install).
## Demo data
Jira project SPF ("SmartPump Firmware"), work types Requirement / Story / Task / Bug / Test,
Test statuses Not run / Passed / Failed. Demo issues carry the label "tg-demo".