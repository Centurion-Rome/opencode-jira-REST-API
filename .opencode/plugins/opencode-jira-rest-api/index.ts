import { Plugin } from "@opencode/plugin";
import { createJiraClient } from "./jira-rest.mjs";

const json = (value: unknown) => JSON.stringify(value, null, 2);
const message = (error: unknown) => error instanceof Error ? error.message : "Unexpected error.";

export default Plugin.define({
  id: "opencode-jira-rest-api",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.namespace({ name: "jira", description: "Direct Jira Cloud REST API tools" });

      const add = (definition: any, action: string, resource: (input: any) => string, run: (input: any) => Promise<unknown>) => {
        editor.add({
          ...definition,
          options: { namespace: "jira", codemode: false },
          async execute(rawInput: unknown, context: any) {
            const input = rawInput as Record<string, unknown>;
            const target = resource(input);
            await ctx.permission.assert({
              sessionID: context.sessionID,
              agent: context.agent,
              source: { type: "tool", messageID: context.messageID, id: context.id },
              action,
              resources: [target],
              save: [target],
            });
            try {
              return { content: json(await run(input)) };
            } catch (error) {
              return { content: `Jira error: ${message(error)}` };
            }
          },
        });
      };

      add({
        name: "search",
        description: "Search issues in one Jira project using an optional plain-text phrase and exact status name; raw JQL is not accepted.",
        input: {
          type: "object",
          properties: {
            projectKey: { type: "string", description: "Project key, e.g. EP2." },
            text: { type: "string", description: "Optional plain-text search phrase, not JQL." },
            status: { type: "string", description: "Optional exact status name from the project." },
            maxResults: { type: "integer", minimum: 1, maximum: 100, description: "Maximum results; defaults to 25." },
          },
          required: ["projectKey"],
          additionalProperties: false,
        },
      }, "jira_search", (input) => String(input.projectKey), (input) => createJiraClient().search(input));

      add({
        name: "get_issue",
        description: "Read a Jira issue by key, including summary, description, status, priority and links.",
        input: {
          type: "object",
          properties: { key: { type: "string", description: "Issue key, e.g. EP2-123." } },
          required: ["key"],
          additionalProperties: false,
        },
      }, "jira_get_issue", (input) => String(input.key), (input) => createJiraClient().getIssue(input));

      add({
        name: "create_issue",
        description: "Create a Jira issue. Confirm the target project, issue type and final wording with the user first.",
        input: {
          type: "object",
          properties: {
            projectKey: { type: "string", description: "Target project key." },
            issueType: { type: "string", description: "Issue type available in the project, e.g. Task, Bug or Story." },
            summary: { type: "string", description: "Issue title." },
            description: { type: "string", description: "Plain-text description; converted to Atlassian Document Format." },
            priority: { type: "string", description: "Optional priority name." },
          },
          required: ["projectKey", "issueType", "summary"],
          additionalProperties: false,
        },
      }, "jira_create_issue", (input) => String(input.projectKey), (input) => createJiraClient().createIssue(input));

      add({
        name: "update_issue",
        description: "Update a Jira issue's summary, description and/or priority.",
        input: {
          type: "object",
          properties: {
            key: { type: "string", description: "Issue key." },
            summary: { type: "string", description: "Replacement title." },
            description: { type: "string", description: "Replacement plain-text description." },
            priority: { type: "string", description: "Replacement priority name." },
          },
          required: ["key"],
          additionalProperties: false,
        },
      }, "jira_update_issue", (input) => String(input.key), (input) => createJiraClient().updateIssue(input));

      add({
        name: "link_issues",
        description: "Link Jira issues. With the default Blocks type, blockingKey blocks blockedKey.",
        input: {
          type: "object",
          properties: {
            blockingKey: { type: "string", description: "Issue that blocks the other issue." },
            blockedKey: { type: "string", description: "Issue that is blocked." },
            linkType: { type: "string", description: "Link type name; defaults to Blocks." },
          },
          required: ["blockingKey", "blockedKey"],
          additionalProperties: false,
        },
      }, "jira_link_issues", (input) => `${input.blockingKey}->${input.blockedKey}`, (input) => createJiraClient().linkIssues(input));
    });
  },
});
