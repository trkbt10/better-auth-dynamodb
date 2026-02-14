/**
 * @file SCIM plugin table generation tests.
 *
 * SCIM plugin from @better-auth/scim provides SCIM 2.0 server support.
 * Allows identity providers to sync identities to your service.
 */
import { DynamoDBClient, DeleteTableCommand, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { getAuthTables } from "@better-auth/core/db";
import { scim } from "@better-auth/scim";
import { generateTableSchemas, applyTableSchemas, createIndexResolversFromSchemas } from "../src";

describe("scim plugin", () => {
	const options = { plugins: [scim()] };

	describe("schema generation", () => {
		it("creates scim tables or extends user", () => {
			const authTables = getAuthTables(options);
			const tableNames = Object.keys(authTables);

			// Log tables for visibility
			const pluginTables = tableNames.filter(
				(name) => !["user", "session", "account", "verification"].includes(name),
			);
			console.log("SCIM plugin tables:", pluginTables);

			// SCIM should at minimum have core tables
			expect(tableNames).toContain("user");
		});

		it("generates schemas", () => {
			const schemas = generateTableSchemas(options);
			const tableNames = schemas.map((s) => s.tableName);

			// Core tables should exist
			expect(tableNames).toContain("user");
			expect(tableNames).toContain("session");
			expect(tableNames).toContain("account");
			expect(tableNames).toContain("verification");
		});

		it("creates GSIs for indexed fields", () => {
			const authTables = getAuthTables(options);
			const schemas = generateTableSchemas(options);

			// Find plugin tables and verify GSIs for indexed fields
			for (const [tableName, tableSchema] of Object.entries(authTables)) {
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
		const prefix = "scim_plugin_test_";

		afterAll(async () => {
			const result = await client.send(new ListTablesCommand({}));
			const tables = result.TableNames?.filter((n) => n.startsWith(prefix)) ?? [];
			for (const name of tables) {
				await client.send(new DeleteTableCommand({ TableName: name }));
			}
		});

		it("creates all scim tables in DynamoDB", async () => {
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
