# OpenCode Jira REST API

A small OpenCode v2 plugin that connects to Jira Cloud through Atlassian's REST API. It adds scoped search and issue read/write tools to OpenCode without an MCP server.

The plugin is designed for internal use by employees. Each person configures their own Jira site, email address and API token locally. This repository contains no Jira credentials and never reads Hermes configuration or `.env` files.

## What it can do

The plugin exposes five tools in OpenCode:

- `jira_search` — search issues in a required project, with optional plain-text phrase and exact status; results are capped at 100.
- `jira_get_issue` — retrieve an issue's summary, description, type, status, priority, assignee, labels and links.
- `jira_create_issue` — create an issue with project, issue type, summary, description and optional priority.
- `jira_update_issue` — update an issue's summary, description and/or priority.
- `jira_link_issues` — create a link; for the default `Blocks` type, the first issue blocks the second.

The two read tools are allowed by the included project permission policy. Create, update and link operations require OpenCode approval. The plugin also checks OpenCode's permission system before every tool call.

## Requirements

- OpenCode v2 with the plugin API (`@opencode/plugin`).
- Jira Cloud account with permission to access the target projects.
- A Jira Cloud API token associated with your own Atlassian account.
- Node.js 20+ only if you want to run the included tests; OpenCode supplies the plugin runtime.

## Install and configure on Windows

1. Clone this repository and open OpenCode in its folder. The checked-in `.opencode/plugins` directory contains the local plugin, and `opencode.jsonc` provides its permission rules.

   ```powershell
   git clone git@github.com:Centurion-Rome/opencode-jira-REST-API.git
   Set-Location .\opencode-jira-REST-API
   ```

2. Create the separate, per-user OpenCode config file from the example:

   ```powershell
   $config = Join-Path $HOME ".config\opencode"
   New-Item -ItemType Directory -Force $config | Out-Null
   Copy-Item .\jira.env.example (Join-Path $config "jira.env")
   notepad (Join-Path $config "jira.env")
   ```

3. Replace the example values in `jira.env`:

   ```dotenv
   JIRA_BASE_URL=https://your-company.atlassian.net
   JIRA_EMAIL=you@company.com
   JIRA_API_TOKEN=your-own-token
   ```

   Create an API token through Atlassian account security. Do not paste it into chat, commit it, or share it with coworkers. The file is outside the repository at `%USERPROFILE%\.config\opencode\jira.env`.

4. Restart OpenCode from the repository folder. Ask it to search a project, for example: “Find open issues in project EP2 related to CodeMeter.” The search tool always scopes the request to the supplied project key.

## macOS and Linux

Clone the repository, open OpenCode in its root, then create the same separate configuration file:

```sh
mkdir -p ~/.config/opencode
cp jira.env.example ~/.config/opencode/jira.env
chmod 600 ~/.config/opencode/jira.env
${EDITOR:-vi} ~/.config/opencode/jira.env
```

Fill in the three values shown above, then restart OpenCode.

## Using it in another OpenCode project

The simplest setup is to copy the plugin directory into that project's `.opencode/plugins/` folder and merge the permission rules from this repository's `opencode.jsonc` into that project's OpenCode config. Keep the `index.ts` and `jira-rest.mjs` files together.

For a global installation, copy `.opencode/plugins/opencode-jira-rest-api/` into OpenCode's global `plugins/` directory (normally `%USERPROFILE%\.config\opencode\plugins\` on Windows or `~/.config/opencode/plugins/` on macOS/Linux). Merge the permission rules into the global `opencode.jsonc`; do not replace an existing config wholesale. The separate `jira.env` file remains at `~/.config/opencode/jira.env`.

The plugin reads credentials from that dedicated OpenCode config file; process environment variables with the same names take precedence. It does not open or read Hermes files.

## How it works

1. OpenCode v2 loads the local plugin from `.opencode/plugins/opencode-jira-rest-api/` and registers the tools in the `jira` namespace.
2. Before each tool runs, the plugin asks OpenCode's permission system to authorize that action and resource. The included config allows reads and asks before writes.
3. `jira-rest.mjs` reads the separate OpenCode config file (or process environment), validates the HTTPS Jira site and credentials, and sends a direct request to `/rest/api/3/...` using `fetch`.
4. The API token is sent as HTTP Basic authentication over HTTPS. It is not returned in tool output. Error handling intentionally omits Jira response bodies to avoid echoing issue data into logs.
5. Jira enforces the configured user's own project and issue permissions. Search queries are always constrained to a project, and descriptions sent to Jira are converted to Atlassian Document Format.

This does not use an Atlassian MCP server, does not read Hermes files, and does not run `curl` or shell commands to access Jira.

## Credentials and security

- Configure a separate credential for OpenCode; this plugin never reads `%LOCALAPPDATA%\hermes\.env` or any other Hermes file.
- Each employee should use their own Atlassian account and API token. Never put a shared token in the repository or send it to employees.
- `jira.env` is plaintext on disk. Keep it in the user's private profile, do not sync it to a shared folder, and use an approved secret manager to inject environment variables if company policy requires one.
- Issue content returned by Jira is supplied to the active OpenCode model. Use the integration only where company data-handling rules allow it.
- Atlassian's official guidance recommends OAuth 2.0 (3LO) over Basic auth for apps, and warns that cloud apps collecting API tokens or instructing customers to create individual tokens/3LO apps do not meet its app security requirements. This repository is a local internal tool, not a Marketplace app; before broad organizational rollout, confirm the intended use with your Atlassian administrator and security team.
- The tool implements only the fields listed above. Jira projects that require additional custom fields may reject issue creation; extend the request schema and payload only for fields approved by your Jira administrator.

## Permissions

The root `opencode.jsonc` sets `jira_search` and `jira_get_issue` to `allow`, and `jira_create_issue`, `jira_update_issue` and `jira_link_issues` to `ask`. Keep write actions set to `ask` or stricter. If you install the plugin globally, merge these rules into your global config as well; the repository's project config does not govern unrelated workspaces.

## Tests

The tests use Node's built-in test runner and mocked HTTP responses; they do not contact Jira or require credentials:

```sh
node --test
```

They cover project-scoped JQL construction and literal escaping, control-character and issue-key validation, separate config-file credentials, Basic authentication construction, Atlassian Document Format conversion, and issue-link direction.

## References

- [OpenCode v2 server plugins](https://dev.opencode.ai/v2/docs/build/plugins/server/)
- [OpenCode v2 plugin migration and custom tools](https://dev.opencode.ai/v2/docs/build/plugins/migrate-v1)
- [OpenCode v2 permissions](https://dev.opencode.ai/v2/docs/permissions/)
- [Jira Cloud REST API v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)
- [Atlassian basic authentication for REST APIs](https://developer.atlassian.com/cloud/jira/service-desk/basic-auth-for-rest-apis/)
