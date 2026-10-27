import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiraClient } from "../.opencode/plugins/opencode-jira-rest-api/jira-rest.mjs";

const env = {
  JIRA_BASE_URL: "https://example.atlassian.net",
  JIRA_EMAIL: "dev@example.com",
  JIRA_API_TOKEN: "dummy",
};
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

function client(fetchImpl, overrides = {}) {
  return createJiraClient({ env: { ...env, ...overrides }, envFilePath: "missing-test-config", fetchImpl });
}

test("search scopes JQL to the given project and uses Basic auth", async () => {
  let request;
  const jira = client(async (url, options) => {
    request = { url: new URL(url), options };
    return jsonResponse({ issues: [{ key: "EP2-1", fields: { summary: "Test", status: { name: "Open" } } }], isLast: true });
  });
  const result = await jira.search({ projectKey: "ep2", text: "CodeMeter", status: "Open", maxResults: 10 });
  assert.equal(request.url.pathname, "/rest/api/3/search/jql");
  assert.equal(request.url.searchParams.get("jql"), 'project = EP2 AND text ~ "CodeMeter" AND status = "Open" ORDER BY updated DESC');
  assert.equal(request.url.searchParams.get("maxResults"), "10");
  assert.equal(request.options.headers.Authorization, `Basic ${Buffer.from("dev@example.com:dummy").toString("base64")}`);
  assert.deepEqual(result.issues[0], { key: "EP2-1", summary: "Test", issueType: "", status: "Open", priority: "", assignee: null, updated: null, links: [] });
});

test("rejects malformed project keys and control characters in search text", async () => {
  const jira = client(async () => { throw new Error("fetch must not run"); });
  await assert.rejects(jira.search({ projectKey: "EP2 OR project = OTHER" }), /valid Jira project key/);
  await assert.rejects(jira.search({ projectKey: "EP2", text: "CodeMeter" + String.fromCharCode(10) + " OR project = OTHER" }), /control characters/);
});

test("search text and status are quoted so JQL syntax cannot escape the project scope", async () => {
  let request;
  const jira = client(async (url) => { request = new URL(url); return jsonResponse({ issues: [], isLast: true }); });
  const text = 'CodeMeter" OR project = OTHER OR text ~ "';
  const status = 'Open" OR project = OTHER OR status = "Open';
  await jira.search({ projectKey: "EP2", text, status });
  assert.equal(request.searchParams.get("jql"), `project = EP2 AND text ~ ${JSON.stringify(text)} AND status = ${JSON.stringify(status)} ORDER BY updated DESC`);
});

test("reads credentials from a separate OpenCode config file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-jira-"));
  const configPath = join(directory, "jira.env");
  try {
    await writeFile(configPath, "JIRA_BASE_URL=https://employee.atlassian.net\nJIRA_EMAIL=employee@example.com\nJIRA_API_TOKEN=separate-token\n", "utf8");
    let authorization;
    const jira = createJiraClient({ env: {}, envFilePath: configPath, fetchImpl: async (_url, options) => {
      authorization = options.headers.Authorization;
      return jsonResponse({ issues: [], isLast: true });
    } });
    await jira.search({ projectKey: "UNI" });
    assert.equal(authorization, `Basic ${Buffer.from("employee@example.com:separate-token").toString("base64")}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("create converts descriptions to Atlassian Document Format", async () => {
  let payload;
  const jira = client(async (_url, options) => {
    payload = JSON.parse(options.body);
    return jsonResponse({ key: "EP2-2", id: "2", self: "https://example.atlassian.net/rest/api/3/issue/2" }, 201);
  });
  const result = await jira.createIssue({ projectKey: "EP2", issueType: "Task", summary: "Add feature", description: "First line\nSecond line", priority: "High" });
  assert.equal(result.key, "EP2-2");
  assert.deepEqual(payload.fields.description.content, [
    { type: "paragraph", content: [{ type: "text", text: "First line" }] },
    { type: "paragraph", content: [{ type: "text", text: "Second line" }] },
  ]);
  assert.deepEqual(payload.fields.priority, { name: "High" });
});

test("Blocks link direction is blocking issue outward to blocked issue inward", async () => {
  let payload;
  const jira = client(async (_url, options) => { payload = JSON.parse(options.body); return new Response(null, { status: 204 }); });
  const result = await jira.linkIssues({ blockingKey: "EP2-3", blockedKey: "EP2-4" });
  assert.deepEqual(payload, { type: { name: "Blocks" }, outwardIssue: { key: "EP2-3" }, inwardIssue: { key: "EP2-4" } });
  assert.deepEqual(result, { blocking: "EP2-3", blocked: "EP2-4", linkType: "Blocks" });
});

test("update rejects empty changes and base URLs must use HTTPS", async () => {
  const jira = client(async () => { throw new Error("fetch must not run"); });
  await assert.rejects(jira.updateIssue({ key: "EP2-1" }), /Provide at least one field/);
  const insecure = client(async () => { throw new Error("fetch must not run"); }, { JIRA_BASE_URL: "http://example.atlassian.net" });
  await assert.rejects(insecure.getIssue({ key: "EP2-1" }), /HTTPS/);
});
