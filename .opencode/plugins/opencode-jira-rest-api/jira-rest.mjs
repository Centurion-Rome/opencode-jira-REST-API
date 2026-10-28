import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_CONFIG = fileURLToPath(new URL(".env", import.meta.url));

function parseEnv(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

async function loadConfig(env, envFilePath) {
  let fileConfig = {};
  try {
    fileConfig = parseEnv(await readFile(envFilePath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error("Could not read the OpenCode Jira config file.");
  }
  const config = { ...fileConfig, ...env };
  const baseUrl = config.JIRA_BASE_URL?.trim();
  const email = config.JIRA_EMAIL?.trim();
  const token = config.JIRA_API_TOKEN?.trim();
  if (!baseUrl || !email || !token) {
    throw new Error(`Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN in ${envFilePath} or the OpenCode process environment.`);
  }
  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw new Error("JIRA_BASE_URL must be a valid HTTPS URL."); }
  if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error("JIRA_BASE_URL must be the HTTPS site root, e.g. https://company.atlassian.net.");
  }
  if (/[\r\n]/.test(email + token)) throw new Error("Jira credentials contain invalid line breaks.");
  return { baseUrl: parsed.origin, email, token };
}

function requireProjectKey(key) {
  const normalized = String(key ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*$/.test(normalized)) throw new Error("Provide a valid Jira project key, e.g. EP2.");
  return normalized;
}

function requireIssueKey(key) {
  const normalized = String(key ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(normalized)) throw new Error("Provide a valid Jira issue key, e.g. EP2-123.");
  return normalized;
}

function jqlLiteral(value, label) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new Error(`${label} must not contain control characters.`);
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function toAdf(text) {
  return {
    type: "doc",
    version: 1,
    content: String(text).split(/\r?\n/).map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}

function plainText(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return node.text ?? "";
  const children = Array.isArray(node.content) ? node.content : [];
  const joined = children.map(plainText).join("");
  return node.type === "paragraph" ? `${joined}\n` : joined;
}

function issueSummary(issue, includeDescription = false) {
  const fields = issue.fields ?? {};
  return {
    key: issue.key,
    summary: fields.summary ?? "",
    issueType: fields.issuetype?.name ?? "",
    status: fields.status?.name ?? "",
    priority: fields.priority?.name ?? "",
    assignee: fields.assignee?.displayName ?? null,
    updated: fields.updated ?? null,
    ...(includeDescription ? { description: plainText(fields.description).trim() } : {}),
    links: (fields.issuelinks ?? []).map((link) => ({
      type: link.type?.name,
      inward: link.inwardIssue?.key,
      outward: link.outwardIssue?.key,
    })),
  };
}

export function createJiraClient({ env = process.env, envFilePath = DEFAULT_CONFIG, fetchImpl = fetch } = {}) {
  async function request(path, { method = "GET", body, signal } = {}) {
    const { baseUrl, email, token } = await loadConfig(env, envFilePath);
    const authorization = `Basic ${Buffer.from(`${email}:${token}`, "utf8").toString("base64")}`;
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: authorization,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ?? AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      // Don't echo response bodies; they may contain sensitive Jira data.
      throw new Error(`Jira REST request failed with HTTP ${response.status} (${method} ${new URL(path, baseUrl).pathname}). Check permissions, project settings and required fields.`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  return {
    async search({ projectKey, text = "", status = "", maxResults = 25, signal } = {}) {
      const project = requireProjectKey(projectKey);
      const requested = Number(maxResults);
      const limit = Number.isFinite(requested) ? Math.min(100, Math.max(1, Math.floor(requested))) : 25;
      const clauses = [`project = ${project}`];
      const phrase = jqlLiteral(text, "Search text");
      const state = jqlLiteral(status, "Status");
      if (phrase) clauses.push(`text ~ ${phrase}`);
      if (state) clauses.push(`status = ${state}`);
      const jql = `${clauses.join(" AND ")} ORDER BY updated DESC`;
      const params = new URLSearchParams({ jql, maxResults: String(limit), fields: "summary,issuetype,status,priority,assignee,updated,issuelinks" });
      const data = await request(`/rest/api/3/search/jql?${params}`, { signal });
      return { issues: (data.issues ?? []).map((issue) => issueSummary(issue)), nextPageToken: data.nextPageToken ?? null, isLast: data.isLast ?? true };
    },

    async getIssue({ key, signal } = {}) {
      const issueKey = requireIssueKey(key);
      const params = new URLSearchParams({ fields: "summary,description,issuetype,status,priority,assignee,created,updated,issuelinks,labels" });
      const issue = await request(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?${params}`, { signal });
      return { ...issueSummary(issue, true), labels: issue.fields?.labels ?? [] };
    },

    async createIssue({ projectKey, issueType, summary, description = "", priority, signal } = {}) {
      const project = requireProjectKey(projectKey);
      const title = String(summary ?? "").trim();
      const type = String(issueType ?? "").trim();
      if (!title) throw new Error("Issue summary is required.");
      if (!type) throw new Error("Issue type is required.");
      const fields = { project: { key: project }, issuetype: { name: type }, summary: title, description: toAdf(description) };
      if (priority?.trim()) fields.priority = { name: priority.trim() };
      const result = await request("/rest/api/3/issue", { method: "POST", body: { fields }, signal });
      return { key: result.key, id: result.id, self: result.self };
    },

    async updateIssue({ key, summary, description, priority, signal } = {}) {
      const issueKey = requireIssueKey(key);
      const fields = {};
      if (summary !== undefined) {
        const title = String(summary).trim();
        if (!title) throw new Error("Summary cannot be empty.");
        fields.summary = title;
      }
      if (description !== undefined) fields.description = toAdf(description);
      if (priority !== undefined) {
        const name = String(priority).trim();
        if (!name) throw new Error("Priority cannot be empty.");
        fields.priority = { name };
      }
      if (!Object.keys(fields).length) throw new Error("Provide at least one field: summary, description or priority.");
      await request(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`, { method: "PUT", body: { fields }, signal });
      return { key: issueKey, updated: Object.keys(fields) };
    },

    async linkIssues({ blockingKey, blockedKey, linkType = "Blocks", signal } = {}) {
      const blocking = requireIssueKey(blockingKey);
      const blocked = requireIssueKey(blockedKey);
      if (blocking === blocked) throw new Error("An issue cannot block itself.");
      const type = String(linkType).trim();
      if (!type) throw new Error("Link type is required.");
      await request("/rest/api/3/issueLink", {
        method: "POST",
        body: { type: { name: type }, outwardIssue: { key: blocking }, inwardIssue: { key: blocked } },
        signal,
      });
      return { blocking, blocked, linkType: type };
    },
  };
}
