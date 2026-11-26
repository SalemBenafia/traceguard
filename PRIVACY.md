# TraceGuard Privacy Policy

TraceGuard runs entirely on Atlassian Forge. It has no remote back end and makes no calls outside Atlassian, so it is built to meet the "Runs on Atlassian" requirements.

**What it stores:** for the Jira projects where TraceGuard is used:
- requirement keys, summaries and statuses
- the key, summary, type and status of each linked work item, which can be in another project
- gap results, scan history and gap history
- the Atlassian account ID, display name and team name of each requirement owner
- app settings, and short-lived caches: team names for up to 24 hours and Jira update markers for up to 5 minutes

**Where:** in Atlassian-hosted Forge storage (Forge SQL and the Key-Value Store), kept separately for each site and in the same data residency location as your Jira. No data is sent to any third-party service. Forge app logs, which the developer can read, contain only project, work item and Confluence space keys, counts and error codes. They never contain names, account IDs or work item text.

**What it reads and writes in your site:** TraceGuard reads Jira work items and their history. It reads owners' team membership from the Teamwork Graph as the signed-in user. It posts gap comments in Jira, which mention the requirement owner, and creates audit pack pages in Confluence when a user asks for one. These comments and pages belong to your Jira and Confluence.

**AI:** TraceGuard does not use Forge LLM. The optional Rovo agent runs in your site's Rovo, which receives the answers from TraceGuard's actions.

**Personal data:** TraceGuard uses Atlassian's personal data reporting API every day. For a closed account, it replaces the owner's name with "Former user" and deletes the account ID and team names. For a changed account, it clears the saved team names, and later scans read the data again. Gap comments and audit pack pages that were already published are not changed.

**Deletion:** when you uninstall TraceGuard, Forge deletes the app's data after Atlassian's storage retention period, currently 28 days. Within that period, the data can be restored only if you reinstall and ask for it. Data the app erases is removed at once from what the app can read, and Atlassian deletes its backup copy on the same schedule. Comments and audit pack pages stay in Jira and Confluence until you delete them.

**Contact:** https://github.com/SalemBenafia/traceguard/issues
