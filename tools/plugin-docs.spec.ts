/**
 * @file Tests for plugin documentation fetcher.
 *
 * The parser fixtures are excerpts copied from https://better-auth.com/docs/llms.txt and the
 * plugin pages it links to (fetched 2026-10-02, Better Auth 1.7.x documentation).
 */
import {
	parsePluginList,
	extractSchemaInfo,
	fetchLlmsTxt,
	listPlugins,
	getPluginInfo,
} from "./plugin-docs";

describe("plugin-docs", () => {
	describe("parsePluginList", () => {
		it("parses plugin entries from the documentation index format", () => {
			const content = `# Better Auth Documentation

> The most comprehensive authentication framework for TypeScript

This index covers the Better Auth 1.7.x documentation.

## Documentation

- [Introduction](https://better-auth.com/docs/introduction.md): Introduction to Better Auth.
  - **Plugins**
  - [Dashboard](https://better-auth.com/docs/infrastructure/plugins/dashboard.md): The \`dash()\` plugin connects your Better Auth instance to Better Auth Infrastructure, enabling analytics tracking, activity monitoring, event logging, and admin dashboard APIs.
- Plugins

  - **Authentication**
  - [Two-Factor Authentication (2FA)](https://better-auth.com/docs/plugins/2fa.md): Enhance your app's security with two-factor authentication.
  - [Username](https://better-auth.com/docs/plugins/username.md): Username plugin

  - **Authorization**
  - API Key
    - [API Key](https://better-auth.com/docs/plugins/api-key.md): API Key plugin for Better Auth.
    - [Reference](https://better-auth.com/docs/plugins/api-key/reference.md): API Key plugin options, permissions, and schema reference.
  - [Organization](https://better-auth.com/docs/plugins/organization.md): The organization plugin allows you to manage your organization's members and teams.
- AI Resources
  - [LLMs.txt](/llms.txt)
`;

			const plugins = parsePluginList(content);

			expect(plugins).toEqual([
				{
					name: "2fa",
					path: "https://better-auth.com/docs/plugins/2fa.md",
					description: "Enhance your app's security with two-factor authentication.",
				},
				{
					name: "username",
					path: "https://better-auth.com/docs/plugins/username.md",
					description: "Username plugin",
				},
				{
					name: "api-key",
					path: "https://better-auth.com/docs/plugins/api-key.md",
					description: "API Key plugin for Better Auth.",
				},
				{
					name: "api-key/reference",
					path: "https://better-auth.com/docs/plugins/api-key/reference.md",
					description: "API Key plugin options, permissions, and schema reference.",
				},
				{
					name: "organization",
					path: "https://better-auth.com/docs/plugins/organization.md",
					description: "The organization plugin allows you to manage your organization's members and teams.",
				},
			]);
		});

		it("parses plugin entries from a versioned documentation index", () => {
			const content = `  - [OIDC Provider](https://better-auth.com/docs/1.6/plugins/oidc-provider.md): Open ID Connect plugin for Better Auth that allows you to have your own OIDC provider.
`;

			expect(parsePluginList(content)).toEqual([
				{
					name: "oidc-provider",
					path: "https://better-auth.com/docs/1.6/plugins/oidc-provider.md",
					description: "Open ID Connect plugin for Better Auth that allows you to have your own OIDC provider.",
				},
			]);
		});

		it("returns empty array for content without plugins", () => {
			const content = `# Better Auth

## Documentation

- [Current documentation index](https://better-auth.com/docs/llms.txt): All pages for the latest stable release.
- [Documentation MCP server](https://mcp.better-auth.com/mcp): Search and retrieve Better Auth documentation from MCP-capable clients.
`;
			expect(parsePluginList(content)).toHaveLength(0);
		});
	});

	describe("extractSchemaInfo", () => {
		it("extracts tables from Table Name labels and DatabaseTable components", () => {
			const markdown = `## Schema [#schema]

The OAuth Provider plugin adds the following tables to the database:

### OAuth Client [#oauth-client-1]

Table Name: \`oauthClient\`



<DatabaseTable name="oauthClient" fields="oauthClientTableFields" />

### OAuth Refresh Token [#oauth-refresh-token]

Table Name: \`oauthRefreshToken\`



<DatabaseTable name="oauthRefreshToken" fields="oauthRefreshTokenTableFields" />

## Options [#options]
`;

			const schema = extractSchemaInfo(markdown);

			expect(schema.tables).toEqual(["oauthClient", "oauthRefreshToken"]);
			expect(schema.indexedFields).toEqual([]);
		});

		it("extracts tables from Table labels and DatabaseTable components (2fa and creem pages)", () => {
			const markdown = `## Schema [#schema]

The plugin requires 1 additional field in the \`user\` table and 1 additional table to store the two factor authentication data.

Table: \`user\`



<DatabaseTable name="user" fields="twoFactorUserTableFields" />

<DatabaseTable name="creem_subscription" fields="creemSubscriptionTableFields" />
`;

			const schema = extractSchemaInfo(markdown);

			expect(schema.tables).toEqual(["user", "creem_subscription"]);
		});

		it("extracts tables from Model tables in the schema section", () => {
			const markdown = `## Schema [#schema]

The plugin adds the following models. Use \`auth generate\` to create the exact schema for your database adapter.

| Model                   | Purpose                                                                         |
| ----------------------- | ------------------------------------------------------------------------------- |
| \`scimConnectionBinding\` | Stores the connection's provisioning domain and decommission status.            |
| \`scimUser\`              | Stores canonical User attributes and the linked Better Auth User ID.            |

## Related [#related]
`;

			const schema = extractSchemaInfo(markdown);

			expect(schema.tables).toEqual(["scimConnectionBinding", "scimUser"]);
		});

		it("extracts the table and indexed fields from a Field table in the schema section", () => {
			const markdown = `## Schema [#schema]

The SIWE plugin adds a \`walletAddress\` table to store user wallet associations:

| Field     | Type    | Description                               |
| --------- | ------- | ----------------------------------------- |
| id        | string  | Primary key                               |
| userId    | string  | Reference to user.id                      |
| address   | string  | Ethereum wallet address                   |
| isPrimary | boolean | Whether this is the user's primary wallet |

## Example Implementation [#example-implementation]
`;

			const schema = extractSchemaInfo(markdown);

			expect(schema.tables).toEqual(["walletAddress"]);
			expect(schema.indexedFields).toEqual(["id", "userId"]);
		});

		it("ignores table mentions outside the schema section", () => {
			const markdown = `<Callout type="warn">
  To sign in with a phone number and password, the user must have a corresponding record in the \`account\` table with the \`providerId\` set specifically to \`"credential"\`. If you are migrating from another auth provider or seeding users manually, ensure this record exists.
</Callout>

## Schema [#schema]

The plugin requires 2 fields to be added to the user table

### User Table [#user-table]

<DatabaseTable name="user" fields="phoneNumberUserTableFields" />
`;

			const schema = extractSchemaInfo(markdown);

			expect(schema.tables).toEqual(["user"]);
		});

		it("does not end the schema section at a comment line inside a fenced code block", () => {
			const markdown = `## Schema [#schema]

\`\`\`bash
# .env
POLAR_ACCESS_TOKEN=...
\`\`\`

The SIWE plugin adds a \`walletAddress\` table to store user wallet associations:
`;

			const schema = extractSchemaInfo(markdown);

			expect(schema.tables).toEqual(["walletAddress"]);
		});
	});

	describe("fetchLlmsTxt (integration)", () => {
		it("fetches llms.txt from better-auth.com", async () => {
			const content = await fetchLlmsTxt();

			expect(content.toLowerCase()).toContain("better auth");
			expect(content.length).toBeGreaterThan(100);
		});
	});

	describe("listPlugins (integration)", () => {
		it("returns list of available plugins", async () => {
			const plugins = await listPlugins();

			expect(plugins.length).toBeGreaterThan(10);

			const pluginNames = plugins.map((p) => p.name);
			expect(pluginNames).toContain("2fa");
			expect(pluginNames).toContain("organization");
			expect(pluginNames).toContain("oauth-provider");
			for (const plugin of plugins) {
				expect(plugin.path).toMatch(/^https:\/\/better-auth\.com\/docs\/plugins\/.+\.md$/);
			}
		});
	});

	describe("getPluginInfo (integration)", () => {
		it("fetches and parses oauth-provider plugin", async () => {
			const { plugin, schema } = await getPluginInfo("oauth-provider");

			expect(plugin.name).toBe("oauth-provider");
			expect(plugin.path).toBe("https://better-auth.com/docs/plugins/oauth-provider.md");
			expect(plugin.description).toContain("OAuth 2.1 provider");
			expect(schema.rawContent).toContain("# OAuth 2.1 Provider");
			expect(schema.tables).toEqual(
				expect.arrayContaining(["oauthClient", "oauthRefreshToken", "oauthAccessToken", "oauthConsent"]),
			);
		});

		it("throws error for unknown plugin", async () => {
			await expect(getPluginInfo("unknown-plugin-xyz")).rejects.toThrow(
				/not found/,
			);
		});
	});
});
