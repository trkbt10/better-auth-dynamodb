/**
 * @file Admin plugin table generation tests.
 *
 * Admin plugin extends user table with role/banned fields.
 * Does NOT create new tables.
 */
import { DynamoDBClient, DeleteTableCommand, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { getAuthTables } from "@better-auth/core/db";
import { admin } from "better-auth/plugins";
import { generateTableSchemas, applyTableSchemas, createIndexResolversFromSchemas } from "../src";

describe("admin plugin", () => {
	const options = { plugins: [admin()] };

	describe("schema generation", () => {
		it("extends user table with role field", () => {
			const authTables = getAuthTables(options);

			expect(authTables.user.fields.role).toBeDefined();
			expect(authTables.user.fields.banned).toBeDefined();
			expect(authTables.user.fields.banReason).toBeDefined();
			expect(authTables.user.fields.banExpires).toBeDefined();
		});

		it("generates schemas without new tables", () => {
			const schemas = generateTableSchemas(options);
			const tableNames = schemas.map((s) => s.tableName);

			// Admin plugin only extends user, no new tables
			expect(tableNames).toContain("user");
			expect(tableNames).toContain("session");
			expect(tableNames).toContain("account");
			expect(tableNames).toContain("verification");
			expect(tableNames).toHaveLength(4);
		});

		it("creates index resolvers", () => {
			const schemas = generateTableSchemas(options);
			const resolvers = createIndexResolversFromSchemas(schemas);

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
		const prefix = "admin_plugin_test_";

		afterAll(async () => {
			const result = await client.send(new ListTablesCommand({}));
			const tables = result.TableNames?.filter((n) => n.startsWith(prefix)) ?? [];
			for (const name of tables) {
				await client.send(new DeleteTableCommand({ TableName: name }));
			}
		});

		it("creates tables in DynamoDB", async () => {
			const schemas = generateTableSchemas(options);
			const tables = schemas.map((s) => ({ ...s, tableName: `${prefix}${s.tableName}` }));

			await applyTableSchemas({ client, tables });

			const result = await client.send(new ListTablesCommand({}));
			const created = result.TableNames?.filter((n) => n.startsWith(prefix)) ?? [];

			expect(created).toHaveLength(4);
			expect(created).toContain(`${prefix}user`);
			expect(created).toContain(`${prefix}session`);
			expect(created).toContain(`${prefix}account`);
			expect(created).toContain(`${prefix}verification`);
		});
	});
});
