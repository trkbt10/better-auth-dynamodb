/**
 * @file MCP plugin table generation tests.
 *
 * MCP plugin (@better-auth/mcp) enables Model Context Protocol authentication.
 * Built on the OAuth Provider plugin (@better-auth/oauth-provider), it creates the oauth tables.
 */
import { DynamoDBClient, DeleteTableCommand, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { getAuthTables } from "@better-auth/core/db";
import { mcp } from "@better-auth/mcp";
import { generateTableSchemas, applyTableSchemas, createIndexResolversFromSchemas } from "../src";

describe("mcp plugin", () => {
	const options = {
		plugins: [
			mcp({
				loginPage: "/login",
				consentPage: "/consent",
				resource: "http://localhost:3000/mcp",
			}),
		],
	};

	describe("schema generation", () => {
		it("creates oauth tables (based on OAuth Provider)", () => {
			const authTables = getAuthTables(options);
			const tableNames = Object.keys(authTables);

			// MCP is based on OAuth Provider, should have oauth tables
			expect(tableNames).toContain("oauthClient");
			expect(tableNames).toContain("oauthAccessToken");
			expect(tableNames).toContain("oauthConsent");
		});

		it("generates schemas with oauth tables", () => {
			const schemas = generateTableSchemas(options);
			const tableNames = schemas.map((s) => s.tableName);

			expect(tableNames).toContain("oauthClient");
			expect(tableNames).toContain("oauthAccessToken");
			expect(tableNames).toContain("oauthConsent");
		});

		it("creates GSIs for oauth tables", () => {
			const schemas = generateTableSchemas(options);

			const clientSchema = schemas.find((s) => s.tableName === "oauthClient");
			expect(clientSchema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "clientId" }),
			);

			const tokenSchema = schemas.find((s) => s.tableName === "oauthAccessToken");
			expect(tokenSchema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "token" }),
			);
		});

		it("creates index resolvers", () => {
			const schemas = generateTableSchemas(options);
			const resolvers = createIndexResolversFromSchemas(schemas);

			expect(
				resolvers.indexNameResolver({ model: "oauthClient", field: "clientId" }),
			).toBe("oauthClient_clientId_idx");
		});
	});

	describe("table creation", () => {
		const client = new DynamoDBClient({
			region: "us-east-1",
			endpoint: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
			credentials: { accessKeyId: "test", secretAccessKey: "test" },
		});
		const prefix = "mcp_plugin_test_";

		afterAll(async () => {
			const result = await client.send(new ListTablesCommand({}));
			const tables = result.TableNames?.filter((n) => n.startsWith(prefix)) ?? [];
			for (const name of tables) {
				await client.send(new DeleteTableCommand({ TableName: name }));
			}
		});

		it("creates all oauth tables in DynamoDB", async () => {
			const schemas = generateTableSchemas(options);
			const tables = schemas.map((s) => ({ ...s, tableName: `${prefix}${s.tableName}` }));

			await applyTableSchemas({ client, tables });

			const result = await client.send(new ListTablesCommand({}));
			const created = result.TableNames?.filter((n) => n.startsWith(prefix)) ?? [];

			expect(created).toContain(`${prefix}oauthClient`);
			expect(created).toContain(`${prefix}oauthAccessToken`);
			expect(created).toContain(`${prefix}oauthConsent`);
		});
	});
});
