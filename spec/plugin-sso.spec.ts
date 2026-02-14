/**
 * @file SSO plugin table generation tests.
 *
 * SSO plugin from @better-auth/sso provides Single Sign-On support.
 * Creates ssoProvider table for OIDC/SAML providers.
 */
import { DynamoDBClient, DeleteTableCommand, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { getAuthTables } from "@better-auth/core/db";
import { sso } from "@better-auth/sso";
import { generateTableSchemas, applyTableSchemas, createIndexResolversFromSchemas } from "../src";

describe("sso plugin", () => {
	const options = { plugins: [sso()] };

	describe("schema generation", () => {
		it("creates sso tables", () => {
			const authTables = getAuthTables(options);
			const tableNames = Object.keys(authTables);

			// Log tables for visibility
			const pluginTables = tableNames.filter(
				(name) => !["user", "session", "account", "verification"].includes(name),
			);
			console.log("SSO plugin tables:", pluginTables);

			// SSO should create ssoProvider table
			expect(tableNames.length).toBeGreaterThan(4);
		});

		it("generates schemas with sso tables", () => {
			const schemas = generateTableSchemas(options);
			const tableNames = schemas.map((s) => s.tableName);

			// Core tables + SSO tables
			expect(tableNames).toContain("user");
			expect(tableNames.length).toBeGreaterThan(4);
		});

		it("creates GSIs for indexed fields", () => {
			const authTables = getAuthTables(options);
			const schemas = generateTableSchemas(options);

			// Find plugin tables and verify GSIs for indexed fields
			for (const [tableName, tableSchema] of Object.entries(authTables)) {
				if (["user", "session", "account", "verification"].includes(tableName)) {
					continue;
				}

				const schema = schemas.find((s) => s.tableName === tableName);
				expect(schema).toBeDefined();

				// Check each indexed field has a GSI
				for (const [fieldName, field] of Object.entries(tableSchema.fields)) {
					if (field.unique === true || field.index === true) {
						const dbFieldName = field.fieldName !== undefined ? field.fieldName : fieldName;
						expect(schema?.indexMappings).toContainEqual(
							expect.objectContaining({ partitionKey: dbFieldName }),
						);
					}
				}
			}
		});

		it("creates index resolvers", () => {
			const schemas = generateTableSchemas(options);
			const resolvers = createIndexResolversFromSchemas(schemas);

			// Verify resolvers work
			expect(resolvers.indexNameResolver({ model: "user", field: "email" })).toBe(
				"user_email_idx",
			);
		});
	});

	describe("table creation", () => {
		const client = new DynamoDBClient({
			region: "us-east-1",
			endpoint: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
			credentials: { accessKeyId: "test", secretAccessKey: "test" },
		});
		const prefix = "sso_plugin_test_";

		afterAll(async () => {
			const result = await client.send(new ListTablesCommand({}));
			const tables = result.TableNames?.filter((n) => n.startsWith(prefix)) ?? [];
			for (const name of tables) {
				await client.send(new DeleteTableCommand({ TableName: name }));
			}
		});

		it("creates all sso tables in DynamoDB", async () => {
			const schemas = generateTableSchemas(options);
			const tables = schemas.map((s) => ({ ...s, tableName: `${prefix}${s.tableName}` }));

			await applyTableSchemas({ client, tables });

			const result = await client.send(new ListTablesCommand({}));
			const created = result.TableNames?.filter((n) => n.startsWith(prefix)) ?? [];

			// All generated schemas should be created
			expect(created.length).toBe(schemas.length);
			for (const schema of schemas) {
				expect(created).toContain(`${prefix}${schema.tableName}`);
			}
		});
	});
});
