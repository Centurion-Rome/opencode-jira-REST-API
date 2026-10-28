## Create an Atlassian API token (all platforms)

Create an API token through Atlassian account security. This is managed in your Atlassian account, not in a Jira project's settings.[1]

1. Open the [Atlassian account API tokens page](https://id.atlassian.com/manage-profile/security/api-tokens) and sign in with the same Atlassian account/email you will put in `JIRA_EMAIL`.[1]
2. Select **Create API token** (not **Create API token with scopes**) and give it a label such as `OpenCode Jira REST API`.[1]
3. Choose an expiry that follows your company's policy. Atlassian's current UI allows 1–365 days and defaults to one year.[1]
4. Create the token and copy it immediately; Atlassian shows the value only once.[1] Store it securely, then use it as `JIRA_API_TOKEN` in the plugin's `.env` file.
