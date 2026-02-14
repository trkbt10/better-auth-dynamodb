/**
 * @file Tests for index resolver utilities.
 */
import { createIndexResolversFromSchemas } from "./resolvers";
import { coreTableSchemas } from "./core-schemas";
import type { TableSchema } from "../dynamodb/types";

describe("createIndexResolversFromSchemas", () => {
	test("resolves index names and key schemas from core table schemas", () => {
		const resolvers = createIndexResolversFromSchemas(coreTableSchemas);

		expect(
			resolvers.indexNameResolver({ model: "session", field: "userId" }),
		).toBe("session_userId_idx");
		expect(
			resolvers.indexNameResolver({ model: "session", field: "token" }),
		).toBe("session_token_idx");
		expect(
			resolvers.indexNameResolver({ model: "account", field: "providerId" }),
		).toBe("account_providerId_accountId_idx");
		expect(
			resolvers.indexNameResolver({ model: "verification", field: "identifier" }),
		).toBe("verification_identifier_idx");
		expect(
			resolvers.indexNameResolver({ model: "user", field: "email" }),
		).toBe("user_email_idx");
		expect(
			resolvers.indexNameResolver({ model: "user", field: "username" }),
		).toBe("user_username_idx");
		expect(
			resolvers.indexNameResolver({ model: "account", field: "accountId" }),
		).toBe("account_accountId_idx");

		expect(
			resolvers.indexKeySchemaResolver({
				model: "verification",
				indexName: "verification_identifier_idx",
			}),
		).toEqual({ partitionKey: "identifier", sortKey: "createdAt" });
	});

	test("throws when schema list is empty", () => {
		expect(() => createIndexResolversFromSchemas([])).toThrow(
			"index resolver creation requires table schemas.",
		);
	});

	test("throws on duplicate partition key mapping", () => {
		const schemas: TableSchema[] = [
			{
				tableName: "session",
				tableDefinition: {
					attributeDefinitions: [
						{ AttributeName: "id", AttributeType: "S" },
						{ AttributeName: "userId", AttributeType: "S" },
					],
					keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
					billingMode: "PAY_PER_REQUEST",
					globalSecondaryIndexes: [
						{
							IndexName: "session_userId_idx",
							KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
							Projection: { ProjectionType: "ALL" },
						},
						{
							IndexName: "session_userId_secondary_idx",
							KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
							Projection: { ProjectionType: "ALL" },
						},
					],
				},
				indexMappings: [
					{
						indexName: "session_userId_idx",
						partitionKey: "userId",
					},
					{
						indexName: "session_userId_secondary_idx",
						partitionKey: "userId",
					},
				],
			},
		];

		expect(() => createIndexResolversFromSchemas(schemas)).toThrow(
			"Duplicate partition key mapping for session.userId.",
		);
	});
});
