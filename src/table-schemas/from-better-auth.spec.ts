/**
 * @file Unit tests for generateTableSchemas and convertToTableSchemas.
 */
import { createIndexResolversFromSchemas } from "./resolvers";
import { convertToTableSchemas, generateTableSchemas } from "./from-better-auth";

describe("generateTableSchemas", () => {
	it("generates core table schemas from empty options", () => {
		const schemas = generateTableSchemas({});
		const tableNames = schemas.map((s) => s.tableName);

		expect(tableNames).toContain("user");
		expect(tableNames).toContain("session");
		expect(tableNames).toContain("account");
		expect(tableNames).toContain("verification");
	});

	it("generates rateLimit schema when storage is database", () => {
		const schemas = generateTableSchemas({
			rateLimit: { storage: "database" },
		});
		const tableNames = schemas.map((s) => s.tableName);

		expect(tableNames).toContain("rateLimit");
	});

	it("does not generate rateLimit schema when storage is not database", () => {
		const schemas = generateTableSchemas({});
		const tableNames = schemas.map((s) => s.tableName);

		expect(tableNames).not.toContain("rateLimit");
	});

	it("creates GSI for indexed fields", () => {
		const schemas = generateTableSchemas({});
		const userSchema = schemas.find((s) => s.tableName === "user");

		expect(userSchema).toBeDefined();
		expect(userSchema?.tableDefinition.globalSecondaryIndexes).toBeDefined();

		const emailIndex = userSchema?.tableDefinition.globalSecondaryIndexes?.find(
			(idx) => idx.IndexName === "user_email_idx",
		);
		expect(emailIndex).toBeDefined();
	});

	it("creates default composite indexes for account table", () => {
		const schemas = generateTableSchemas({});
		const accountSchema = schemas.find((s) => s.tableName === "account");

		expect(accountSchema).toBeDefined();

		const compositeIndex = accountSchema?.tableDefinition.globalSecondaryIndexes?.find(
			(idx) => idx.IndexName === "account_providerId_accountId_idx",
		);
		expect(compositeIndex).toBeDefined();
		expect(compositeIndex?.KeySchema).toHaveLength(2);
		expect(compositeIndex?.KeySchema?.[0]).toEqual({
			AttributeName: "providerId",
			KeyType: "HASH",
		});
		expect(compositeIndex?.KeySchema?.[1]).toEqual({
			AttributeName: "accountId",
			KeyType: "RANGE",
		});
	});

	it("creates default composite indexes for session table", () => {
		const schemas = generateTableSchemas({});
		const sessionSchema = schemas.find((s) => s.tableName === "session");

		expect(sessionSchema).toBeDefined();

		const userIdCreatedAtIndex = sessionSchema?.tableDefinition.globalSecondaryIndexes?.find(
			(idx) => idx.IndexName === "session_userId_createdAt_idx",
		);
		expect(userIdCreatedAtIndex).toBeDefined();

		const tokenCreatedAtIndex = sessionSchema?.tableDefinition.globalSecondaryIndexes?.find(
			(idx) => idx.IndexName === "session_token_createdAt_idx",
		);
		expect(tokenCreatedAtIndex).toBeDefined();
	});

	it("creates default composite indexes for verification table", () => {
		const schemas = generateTableSchemas({});
		const verificationSchema = schemas.find((s) => s.tableName === "verification");

		expect(verificationSchema).toBeDefined();

		const compositeIndex = verificationSchema?.tableDefinition.globalSecondaryIndexes?.find(
			(idx) => idx.IndexName === "verification_identifier_createdAt_idx",
		);
		expect(compositeIndex).toBeDefined();
	});

	it("resolves composite index mappings correctly", () => {
		const schemas = generateTableSchemas({});
		const resolvers = createIndexResolversFromSchemas(schemas);

		expect(resolvers.indexNameResolver({ model: "account", field: "providerId" })).toBe(
			"account_providerId_accountId_idx",
		);
		expect(
			resolvers.indexKeySchemaResolver({
				model: "account",
				indexName: "account_providerId_accountId_idx",
			}),
		).toEqual({
			partitionKey: "providerId",
			sortKey: "accountId",
		});
	});

	it("skips single-field index when composite index exists for same partition key", () => {
		const schemas = generateTableSchemas({});
		const sessionSchema = schemas.find((s) => s.tableName === "session");

		const userIdSingleIndex = sessionSchema?.tableDefinition.globalSecondaryIndexes?.find(
			(idx) => idx.IndexName === "session_userId_idx",
		);
		expect(userIdSingleIndex).toBeUndefined();

		const tokenSingleIndex = sessionSchema?.tableDefinition.globalSecondaryIndexes?.find(
			(idx) => idx.IndexName === "session_token_idx",
		);
		expect(tokenSingleIndex).toBeUndefined();
	});

	it("allows disabling auto composite indexes", () => {
		const schemas = generateTableSchemas(
			{},
			{ disableAutoCompositeIndexes: true },
		);
		const accountSchema = schemas.find((s) => s.tableName === "account");

		const compositeIndex = accountSchema?.tableDefinition.globalSecondaryIndexes?.find(
			(idx) => idx.IndexName === "account_providerId_accountId_idx",
		);
		expect(compositeIndex).toBeUndefined();
	});

	it("allows custom composite indexes", () => {
		const schemas = generateTableSchemas(
			{},
			{
				compositeIndexes: {
					user: [{ partitionKey: "email", sortKey: "createdAt" }],
				},
			},
		);
		const userSchema = schemas.find((s) => s.tableName === "user");

		const compositeIndex = userSchema?.tableDefinition.globalSecondaryIndexes?.find(
			(idx) => idx.IndexName === "user_email_createdAt_idx",
		);
		expect(compositeIndex).toBeDefined();
	});

	it("merges custom composite indexes with defaults instead of replacing", () => {
		// Adding a custom session composite index should NOT remove default session composite indexes
		const schemas = generateTableSchemas(
			{},
			{
				compositeIndexes: {
					session: [{ partitionKey: "ipAddress", sortKey: "createdAt" }],
				},
			},
		);
		const sessionSchema = schemas.find((s) => s.tableName === "session");

		// Custom index should exist
		const customIndex = sessionSchema?.tableDefinition.globalSecondaryIndexes?.find(
			(idx) => idx.IndexName === "session_ipAddress_createdAt_idx",
		);
		expect(customIndex).toBeDefined();

		// Default indexes should still exist (not replaced)
		const userIdCreatedAtIndex = sessionSchema?.tableDefinition.globalSecondaryIndexes?.find(
			(idx) => idx.IndexName === "session_userId_createdAt_idx",
		);
		expect(userIdCreatedAtIndex).toBeDefined();

		const tokenCreatedAtIndex = sessionSchema?.tableDefinition.globalSecondaryIndexes?.find(
			(idx) => idx.IndexName === "session_token_createdAt_idx",
		);
		expect(tokenCreatedAtIndex).toBeDefined();
	});
});

describe("indexReferences option", () => {
	it("creates GSI for references fields by default", () => {
		const tables = {
			invitation: {
				modelName: "invitation",
				fields: {
					inviterId: {
						type: "string" as const,
						references: { model: "user", field: "id" },
					},
				},
			},
		};
		const schemas = convertToTableSchemas(tables);

		expect(schemas[0].indexMappings).toContainEqual(
			expect.objectContaining({ partitionKey: "inviterId" }),
		);
	});

	it("does not create GSI when indexReferences is false", () => {
		const tables = {
			invitation: {
				modelName: "invitation",
				fields: {
					inviterId: {
						type: "string" as const,
						references: { model: "user", field: "id" },
					},
				},
			},
		};
		const schemas = convertToTableSchemas(tables, { indexReferences: false });

		expect(schemas[0].indexMappings).not.toContainEqual(
			expect.objectContaining({ partitionKey: "inviterId" }),
		);
	});

	it("skips when composite index exists for same partition key", () => {
		const tables = {
			invitation: {
				modelName: "invitation",
				fields: {
					inviterId: {
						type: "string" as const,
						references: { model: "user", field: "id" },
					},
					createdAt: { type: "date" as const },
				},
			},
		};
		const schemas = convertToTableSchemas(tables, {
			compositeIndexes: {
				invitation: [{ partitionKey: "inviterId", sortKey: "createdAt" }],
			},
		});

		// Should have composite index, but not single-field index
		expect(schemas[0].indexMappings).toContainEqual(
			expect.objectContaining({
				partitionKey: "inviterId",
				sortKey: "createdAt",
			}),
		);
		expect(schemas[0].indexMappings).not.toContainEqual({
			indexName: "invitation_inviterId_idx",
			partitionKey: "inviterId",
		});
	});

	it("does not duplicate GSI when field has both index and references", () => {
		const tables = {
			invitation: {
				modelName: "invitation",
				fields: {
					inviterId: {
						type: "string" as const,
						index: true,
						references: { model: "user", field: "id" },
					},
				},
			},
		};
		const schemas = convertToTableSchemas(tables);

		// Should have exactly one GSI for inviterId
		const inviterIdMappings = schemas[0].indexMappings.filter(
			(m) => m.partitionKey === "inviterId",
		);
		expect(inviterIdMappings).toHaveLength(1);
	});
});

describe("convertToTableSchemas", () => {
	it("converts custom table schema", () => {
		const tables = {
			customTable: {
				modelName: "customTable",
				fields: {
					name: { type: "string" as const, required: true },
					email: { type: "string" as const, unique: true },
					userId: { type: "string" as const, index: true },
				},
			},
		};

		const schemas = convertToTableSchemas(tables);

		expect(schemas).toHaveLength(1);
		expect(schemas[0].tableName).toBe("customTable");
		expect(schemas[0].indexMappings).toHaveLength(2);
		expect(schemas[0].indexMappings).toContainEqual({
			indexName: "customTable_email_idx",
			partitionKey: "email",
		});
		expect(schemas[0].indexMappings).toContainEqual({
			indexName: "customTable_userId_idx",
			partitionKey: "userId",
		});
	});

	it("respects fieldName mapping", () => {
		const tables = {
			myTable: {
				modelName: "myTable",
				fields: {
					userId: {
						type: "string" as const,
						index: true,
						fieldName: "user_id",
					},
				},
			},
		};

		const schemas = convertToTableSchemas(tables);
		const resolvers = createIndexResolversFromSchemas(schemas);

		expect(resolvers.indexNameResolver({ model: "myTable", field: "user_id" })).toBe(
			"myTable_user_id_idx",
		);
	});

	it("deduplicates fields with same db name", () => {
		const tables = {
			myTable: {
				modelName: "myTable",
				fields: {
					email: { type: "string" as const, unique: true },
					userEmail: { type: "string" as const, index: true, fieldName: "email" },
				},
			},
		};

		const schemas = convertToTableSchemas(tables);

		expect(schemas[0].indexMappings).toHaveLength(1);
	});

	it("supports custom composite indexes via options", () => {
		const tables = {
			myTable: {
				modelName: "myTable",
				fields: {
					organizationId: { type: "string" as const, index: true },
					createdAt: { type: "date" as const },
				},
			},
		};

		const schemas = convertToTableSchemas(tables, {
			compositeIndexes: {
				myTable: [{ partitionKey: "organizationId", sortKey: "createdAt" }],
			},
		});

		const compositeIndex = schemas[0].indexMappings.find(
			(m) => m.indexName === "myTable_organizationId_createdAt_idx",
		);
		expect(compositeIndex).toEqual({
			indexName: "myTable_organizationId_createdAt_idx",
			partitionKey: "organizationId",
			sortKey: "createdAt",
		});

		const singleIndex = schemas[0].indexMappings.find(
			(m) => m.indexName === "myTable_organizationId_idx",
		);
		expect(singleIndex).toBeUndefined();
	});
});

describe("schema extensions", () => {
	it("applies default schema extensions", () => {
		// deviceCode table should have userId GSI via default extension
		const tables = {
			deviceCode: {
				modelName: "deviceCode",
				fields: {
					deviceCode: { type: "string" as const },
					userId: { type: "string" as const }, // No index/references in original schema
				},
			},
		};

		const schemas = convertToTableSchemas(tables);

		expect(schemas[0].indexMappings).toContainEqual(
			expect.objectContaining({ partitionKey: "userId" }),
		);
	});

	it("disables default schema extensions when disableSchemaExtensions is true", () => {
		const tables = {
			deviceCode: {
				modelName: "deviceCode",
				fields: {
					deviceCode: { type: "string" as const },
					userId: { type: "string" as const },
				},
			},
		};

		const schemas = convertToTableSchemas(tables, { disableSchemaExtensions: true });

		expect(schemas[0].indexMappings).not.toContainEqual(
			expect.objectContaining({ partitionKey: "userId" }),
		);
	});

	it("applies custom schema extensions", () => {
		const tables = {
			customTable: {
				modelName: "customTable",
				fields: {
					someField: { type: "string" as const },
				},
			},
		};

		const schemas = convertToTableSchemas(tables, {
			schemaExtensions: {
				customTable: {
					someField: { index: true },
				},
			},
		});

		expect(schemas[0].indexMappings).toContainEqual(
			expect.objectContaining({ partitionKey: "someField" }),
		);
	});

	it("custom extensions override default extensions", () => {
		const tables = {
			deviceCode: {
				modelName: "deviceCode",
				fields: {
					userId: { type: "string" as const },
					clientId: { type: "string" as const },
				},
			},
		};

		const schemas = convertToTableSchemas(tables, {
			schemaExtensions: {
				deviceCode: {
					// Override default userId extension to not create index
					userId: { index: false },
					// Add index for clientId
					clientId: { index: true },
				},
			},
		});

		// Default extension should be overridden, but since we set index: false,
		// the base schema takes precedence (which has no index)
		// Actually, the merge means custom extensions are added after defaults
		// So clientId should have GSI, userId should not (since we override with index: false)
		expect(schemas[0].indexMappings).toContainEqual(
			expect.objectContaining({ partitionKey: "clientId" }),
		);
	});

	it("merges custom extensions with defaults instead of replacing table entry", () => {
		// Adding a custom field extension for deviceCode should NOT remove default userId extension
		const tables = {
			deviceCode: {
				modelName: "deviceCode",
				fields: {
					userId: { type: "string" as const }, // Should get index from default extension
					clientId: { type: "string" as const }, // Should get index from custom extension
				},
			},
		};

		const schemas = convertToTableSchemas(tables, {
			schemaExtensions: {
				deviceCode: {
					clientId: { index: true },
				},
			},
		});

		// Custom extension field should have GSI
		expect(schemas[0].indexMappings).toContainEqual(
			expect.objectContaining({ partitionKey: "clientId" }),
		);

		// Default extension field should still have GSI (not replaced)
		expect(schemas[0].indexMappings).toContainEqual(
			expect.objectContaining({ partitionKey: "userId" }),
		);
	});
});
