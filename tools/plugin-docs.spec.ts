/**
 * @file Tests for plugin documentation fetcher.
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
		it("parses plugin entries from llms.txt format", () => {
			const content = `
# Better Auth Documentation

## Plugins
- [Two Factor](/llms.txt/docs/plugins/2fa.md): Two-factor authentication
- [Organization](/llms.txt/docs/plugins/organization.md): Organization management
- [OIDC Provider](/llms.txt/docs/plugins/oidc-provider.md): OpenID Connect provider
`;

			const plugins = parsePluginList(content);

			expect(plugins).toHaveLength(3);
			expect(plugins[0]).toEqual({
				name: "2fa",
				path: "/llms.txt/docs/plugins/2fa.md",
				description: "Two-factor authentication",
			});
			expect(plugins[1].name).toBe("organization");
			expect(plugins[2].name).toBe("oidc-provider");
		});

		it("returns empty array for content without plugins", () => {
			const content = "# No plugins here";
			expect(parsePluginList(content)).toHaveLength(0);
		});
	});

	describe("extractSchemaInfo", () => {
		it("extracts table names from markdown headers", () => {
			const markdown = `
# OIDC Provider

## Database Tables

### 1. oauthApplication
Stores OAuth clients.

### 2. oauthAccessToken
Stores access tokens.

### 3. oauthConsent
Tracks user consent.
`;

			const schema = extractSchemaInfo(markdown);

			expect(schema.tables).toContain("oauthApplication");
			expect(schema.tables).toContain("oauthAccessToken");
			expect(schema.tables).toContain("oauthConsent");
		});

		it("extracts indexed fields from field descriptions", () => {
			const markdown = `
### Fields
- \`clientId\` (string, Primary Key): Unique client identifier
- \`userId\` (string, Foreign Key): References user table
- \`email\` (string, unique): User email
- \`token\` is indexed for lookups
`;

			const schema = extractSchemaInfo(markdown);

			expect(schema.indexedFields).toContain("clientId");
			expect(schema.indexedFields).toContain("userId");
			expect(schema.indexedFields).toContain("email");
			expect(schema.indexedFields).toContain("token");
		});

		it("skips common non-table words", () => {
			const markdown = `
### Schema
### Fields
### Migration
### oauthClient
`;

			const schema = extractSchemaInfo(markdown);

			expect(schema.tables).not.toContain("Schema");
			expect(schema.tables).not.toContain("Fields");
			expect(schema.tables).not.toContain("Migration");
			expect(schema.tables).toContain("oauthClient");
		});

		it("extracts tables from Better Auth docs format (Table Name: `xxx`)", () => {
			const markdown = `
## Schema

### OAuth Application

Table Name: \`oauthApplication\`

<DatabaseTable fields={[...]} />

### OAuth Access Token

Table Name: \`oauthAccessToken\`
`;

			const schema = extractSchemaInfo(markdown);

			expect(schema.tables).toContain("oauthApplication");
			expect(schema.tables).toContain("oauthAccessToken");
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
			expect(pluginNames).toContain("oidc-provider");
		});
	});

	describe("getPluginInfo (integration)", () => {
		it("fetches and parses oidc-provider plugin", async () => {
			const { plugin, schema } = await getPluginInfo("oidc-provider");

			expect(plugin.name).toBe("oidc-provider");
			expect(plugin.description).toBeDefined();
			expect(schema.rawContent.length).toBeGreaterThan(100);
		});

		it("throws error for unknown plugin", async () => {
			await expect(getPluginInfo("unknown-plugin-xyz")).rejects.toThrow(
				/not found/,
			);
		});
	});
});
