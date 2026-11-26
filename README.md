# TraceGuard

TraceGuard builds a live matrix that links every requirement to its implementation and tests. It finds audit gaps, such as a missing test or a test that passed before the requirement changed, and explains each one. It then publishes a complete audit pack to Confluence in one click.

**Who it is for:** quality, regulatory and engineering teams in fields such as medical devices and aerospace.

## 1. Features and Forge modules

| Feature | Forge module or API |
|---|---|
| Dashboard: Overview, Matrix, Gaps, History, Settings | `jira:projectPage` |
| Trace for the open work item | `jira:issuePanel` |
| Live updates when work items or links change | `trigger` |
| Nightly scan, gap comments and daily privacy check | `scheduledTrigger` |
| Chat about audit status and create audit packs | `rovo:agent` + 4 `action` modules |
| Matrix, scan history and gap history | Forge SQL (`sql`) |
| Settings and short-lived caches | KVS |
| Team of each requirement owner | Teamwork Graph API |
| Audit pack pages | Confluence REST API |

TraceGuard does **not** use Forge LLM. Gaps come from clear, unit-tested rules, and Rovo provides the chat.

## 2. Install

1. Open `<INSTALL_LINK>` and choose your site.
2. Install the app in **both Jira and Confluence** on the same site.
3. A site admin must approve the requested scopes. Rovo must be enabled to test the agent.

## 3. Setup in 10 minutes

**Step 1: Choose a project.** Create a Jira project with key `SPF` and work types Requirement, Story, Task, Bug and Test. Test needs statuses Not run, Passed and Failed. Story needs In Progress and Done. Allow moves between all statuses. Or use an existing project and enter its JQL, work types and statuses in TraceGuard **Settings**.

**Step 2: Add demo data (optional).** This creates 20 requirements with linked Stories and Tests, labelled `tg-demo`. It needs Node 22+ and a Jira API token without scopes.

```bash
git clone https://github.com/SalemBenafia/traceguard.git
cd traceguard
cp scripts/.env.example scripts/.env   # add site URL, email, token, project key
npm run seed                           # remove later: npm run seed:reset
```

**Step 3: Save Settings.** Open TraceGuard from the project sidebar, go to **Settings**, enter your Confluence space key and click **Save**. Saving turns on live updates and the nightly scan.

**Step 4: Teamwork Graph (optional).** The install link includes the saved query, and an owner with no team shows "No team found". To deploy your own copy, register this query in the Teamwork Graph Query Builder and set its key:

```text
MATCH (user:AtlassianUser {ari: $id})-[:atlassian_user_is_in_atlassian_team]->(team:AtlassianTeam)
RETURN collect(distinct team) as teams
forge variables set -e development TWG_USER_TEAMS_QUERY_KEY <query-key>
forge deploy -e development
```

## 4. How to test in under 5 minutes

1. **Project page** (demo data in `SPF`): open TraceGuard and click **Run first scan**. Expect 20 requirements: 9 Green, 4 Amber, 7 Red, 45% audit-ready.
2. **Live update:** open `SPF-3`, open its linked Test and move it from Failed to Passed. Step 8 checks the result.
3. **Matrix and Gaps:** in **Matrix**, set Status to Red and try the Team filter. **Gaps** groups the gaps by type.
4. **Issue panel:** open `SPF-7`, then **Traceability** from the Apps button. It shows the requirement changed after its last passed test. Its linked Story shows the requirement it supports.
5. **Nightly job:** in **Settings**, click **Run nightly job now**. Then open `SPF-5` and see the TraceGuard gap comment.
6. **Audit pack:** on **Overview**, enter your space key and release `2.4.0`, click **Create audit pack** and open the link.
7. **Rovo:** in Rovo chat, choose **TraceGuard Audit Assistant**. Ask `Which requirements are not audit-ready in SPF?`, then `Explain SPF-7`, then `Create an audit pack for SPF`.
8. **History:** up to 3 minutes after step 2, reload TraceGuard. **History** shows a **Jira update** scan, and Overview shows 10 Green, 4 Amber, 6 Red, 50%.

## 5. Architecture, data and permissions

```text
Project page, issue panel (UI Kit) --+
Rovo agent + 4 actions --------------+--> Forge functions
Jira event trigger ------------------+      |-- Jira REST: requirements, links, history, comments
Daily scheduled trigger -------------+      |-- Rule engine: pure, unit-tested gap rules
                                            |-- Forge SQL + KVS: results, settings, caches
                                            |-- Teamwork Graph: owner team (as the user)
                                            +-- Confluence REST: audit pack (as the user)
```

**Access:** screens and Rovo show only work items the user can see. Scans read Jira as the app, and the app makes no external calls.

**Data stored per install:** Forge SQL keeps the matrix, owners, gaps, links and scan history. KVS keeps settings and short-lived caches.

| Scope | Why it is needed |
|---|---|
| `read:jira-work` | Read requirements, links, change history and user permissions |
| `write:jira-work` | Post gap comments on requirements |
| `read:jira-user` | Show requirement owners |
| `storage:app` | Save settings and cached data |
| `read:graph:user:atlassian`, `read:graph:team:atlassian` | Find the owner's team |
| `read:space:confluence`, `read:page:confluence` | Find the space and avoid duplicate page titles |
| `write:page:confluence` | Create the audit pack page |

## 6. Privacy

TraceGuard stores the account IDs, names and teams of requirement owners. A daily job reports them with the Forge privacy API. For a **closed** account, the owner becomes "Former user" and its ID and teams are deleted. For an **updated** account, saved teams are cleared and later scans read the data again. Logs hold only counts. Published audit packs and Jira comments are not changed.

## 7. Known limits

- Each scan covers up to **500 requirements**.
- Jira events can take **up to 3 minutes** to update TraceGuard.
- A manual Rescan runs for about 15 seconds, so large projects finish in the nightly scan.
- At most 20 gap comments per day per site. An audit pack is visible to everyone in its Confluence space.
