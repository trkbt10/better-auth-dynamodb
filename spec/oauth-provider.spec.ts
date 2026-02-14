/**
 * @file OAuth Provider plugin (from @better-auth/oauth-provider) schema tests.
 *
 * This plugin is from a separate package, not better-auth/plugins.
 * Tests that external Better Auth plugins work with generateTableSchemas.
 *
 * Note: Adapter integration tests are not included because oauthProvider
 * requires complex JWT configuration that is out of scope for schema testing.
 */
import { getAuthTables } from "@better-auth/core/db";
import { oauthProvider } from "@better-auth/oauth-provider";
import { generateTableSchemas, createIndexResolversFromSchemas } from "../src";

describe("oauthProvider plugin (external package)", () => {
	const options = {
		plugins: [
			oauthProvider({
				loginPage: "/login",
				consentPage: "/consent",
			}),
		],
	};

	describe("table generation", () => {
		it("generates tables from external package plugin", () => {
			const authTables = getAuthTables(options);
			const schemas = generateTableSchemas(options);
			const tableNames = schemas.map((s) => s.tableName);

			// Verify plugin tables are included in getAuthTables
			const pluginTableNames = Object.keys(authTables).filter(
				(name) => !["user", "session", "account", "verification"].includes(name),
			);
			expect(pluginTableNames.length).toBeGreaterThan(0);

			// Verify all plugin tables are in generated schemas
			for (const pluginTable of pluginTableNames) {
				expect(tableNames).toContain(pluginTable);
			}
		});
	});

	describe("oauthClient table", () => {
		it("generates GSIs for indexed and unique fields", () => {
			const authTables = getAuthTables(options);

			if (!authTables.oauthClient) {
				// Skip if oauthClient table doesn't exist (schema may differ by version)
				return;
			}

			const schemas = generateTableSchemas(options);
			const schema = schemas.find((s) => s.tableName === "oauthClient");

			expect(schema).toBeDefined();

			// Find indexed/unique fields
			const indexedFields = Object.entries(authTables.oauthClient.fields)
				.filter(([, field]) => field.unique === true || field.index === true)
				.map(([name, field]) => (field.fieldName !== undefined ? field.fieldName : name));

			// Verify GSIs exist for all indexed/unique fields
			for (const field of indexedFields) {
				expect(schema?.indexMappings).toContainEqual(
					expect.objectContaining({ partitionKey: field }),
				);
			}
		});
	});

	describe("oauthAccessToken table", () => {
		it("generates GSIs for indexed and unique fields", () => {
			const authTables = getAuthTables(options);

			if (!authTables.oauthAccessToken) {
				return;
			}

			const schemas = generateTableSchemas(options);
			const schema = schemas.find((s) => s.tableName === "oauthAccessToken");

			expect(schema).toBeDefined();

			const indexedFields = Object.entries(authTables.oauthAccessToken.fields)
				.filter(([, field]) => field.unique === true || field.index === true)
				.map(([name, field]) => (field.fieldName !== undefined ? field.fieldName : name));

			for (const field of indexedFields) {
				expect(schema?.indexMappings).toContainEqual(
					expect.objectContaining({ partitionKey: field }),
				);
			}
		});
	});

	describe("oauthRefreshToken table", () => {
		it("generates GSIs for indexed and unique fields", () => {
			const authTables = getAuthTables(options);

			if (!authTables.oauthRefreshToken) {
				return;
			}

			const schemas = generateTableSchemas(options);
			const schema = schemas.find((s) => s.tableName === "oauthRefreshToken");

			expect(schema).toBeDefined();

			const indexedFields = Object.entries(authTables.oauthRefreshToken.fields)
				.filter(([, field]) => field.unique === true || field.index === true)
				.map(([name, field]) => (field.fieldName !== undefined ? field.fieldName : name));

			for (const field of indexedFields) {
				expect(schema?.indexMappings).toContainEqual(
					expect.objectContaining({ partitionKey: field }),
				);
			}
		});
	});

	describe("oauthConsent table", () => {
		it("generates GSIs for indexed and unique fields", () => {
			const authTables = getAuthTables(options);

			if (!authTables.oauthConsent) {
				return;
			}

			const schemas = generateTableSchemas(options);
			const schema = schemas.find((s) => s.tableName === "oauthConsent");

			expect(schema).toBeDefined();

			const indexedFields = Object.entries(authTables.oauthConsent.fields)
				.filter(([, field]) => field.unique === true || field.index === true)
				.map(([name, field]) => (field.fieldName !== undefined ? field.fieldName : name));

			for (const field of indexedFields) {
				expect(schema?.indexMappings).toContainEqual(
					expect.objectContaining({ partitionKey: field }),
				);
			}
		});
	});

	describe("index resolvers", () => {
		it("creates valid resolvers from generated schemas", () => {
			const schemas = generateTableSchemas(options);
			const resolvers = createIndexResolversFromSchemas(schemas);

			// Verify resolvers work for plugin tables
			const pluginSchemas = schemas.filter(
				(s) => !["user", "session", "account", "verification"].includes(s.tableName),
			);

			for (const schema of pluginSchemas) {
				for (const mapping of schema.indexMappings) {
					const indexName = resolvers.indexNameResolver({
						model: schema.tableName,
						field: mapping.partitionKey,
					});
					expect(indexName).toBe(mapping.indexName);
				}
			}
		});
	});
});
