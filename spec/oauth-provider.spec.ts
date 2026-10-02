/**
 * @file OAuth Provider plugin (from @better-auth/oauth-provider) schema tests.
 *
 * This plugin is from a separate package, not better-auth/plugins.
 * Tests that external Better Auth plugins work with generateTableSchemas.
 *
 * oauthProvider is the successor of the oidcProvider plugin that better-auth
 * 1.7.6 no longer ships. The adapter integration tests run it together with the
 * jwt plugin, which oauthProvider requires (without it the auth API fails with
 * the error `jwt_config`).
 */
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { getAuthTables } from "@better-auth/core/db";
import { oauthProvider } from "@better-auth/oauth-provider";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { dynamodbAdapter } from "../src/adapter";
import { generateTableSchemas, createIndexResolversFromSchemas } from "../src";
import { createStatefulDocumentClient } from "./stateful-document-client";

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
		it("clientId(unique), userId(ref) → GSIs", () => {
			const authTables = getAuthTables(options);
			expect(authTables.oauthClient.fields.clientId.unique).toBe(true);
			expect(authTables.oauthClient.fields.userId.index).toBe(true);
			expect(authTables.oauthClient.fields.userId.references?.model).toBe("user");

			const schemas = generateTableSchemas(options);
			const schema = schemas.find((s) => s.tableName === "oauthClient");

			expect(schema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "clientId" }),
			);
			expect(schema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "userId" }),
			);
		});

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
		it("token(unique), clientId(ref), userId(ref) → GSIs", () => {
			const authTables = getAuthTables(options);
			expect(authTables.oauthAccessToken.fields.token.unique).toBe(true);
			expect(authTables.oauthAccessToken.fields.clientId.index).toBe(true);
			expect(authTables.oauthAccessToken.fields.clientId.references?.model).toBe(
				"oauthClient",
			);
			expect(authTables.oauthAccessToken.fields.userId.index).toBe(true);
			expect(authTables.oauthAccessToken.fields.userId.references?.model).toBe("user");

			const schemas = generateTableSchemas(options);
			const schema = schemas.find((s) => s.tableName === "oauthAccessToken");

			expect(schema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "token" }),
			);
			expect(schema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "clientId" }),
			);
			expect(schema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "userId" }),
			);
		});

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
		it("token(unique), clientId(ref), userId(ref) → GSIs", () => {
			const authTables = getAuthTables(options);
			expect(authTables.oauthRefreshToken.fields.token.unique).toBe(true);
			expect(authTables.oauthRefreshToken.fields.clientId.index).toBe(true);
			expect(authTables.oauthRefreshToken.fields.clientId.references?.model).toBe(
				"oauthClient",
			);
			expect(authTables.oauthRefreshToken.fields.userId.index).toBe(true);
			expect(authTables.oauthRefreshToken.fields.userId.references?.model).toBe("user");

			const schemas = generateTableSchemas(options);
			const schema = schemas.find((s) => s.tableName === "oauthRefreshToken");

			expect(schema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "token" }),
			);
			expect(schema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "clientId" }),
			);
			expect(schema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "userId" }),
			);
		});

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
		it("clientId(ref), userId(ref) → GSIs", () => {
			const authTables = getAuthTables(options);
			expect(authTables.oauthConsent.fields.clientId.index).toBe(true);
			expect(authTables.oauthConsent.fields.clientId.references?.model).toBe("oauthClient");
			expect(authTables.oauthConsent.fields.userId.index).toBe(true);
			expect(authTables.oauthConsent.fields.userId.references?.model).toBe("user");

			const schemas = generateTableSchemas(options);
			const schema = schemas.find((s) => s.tableName === "oauthConsent");

			expect(schema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "clientId" }),
			);
			expect(schema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "userId" }),
			);
		});

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
		it("returns correct GSI names", () => {
			const schemas = generateTableSchemas(options);
			const resolvers = createIndexResolversFromSchemas(schemas);

			expect(
				resolvers.indexNameResolver({ model: "oauthClient", field: "clientId" }),
			).toBe("oauthClient_clientId_idx");
			expect(
				resolvers.indexNameResolver({ model: "oauthAccessToken", field: "token" }),
			).toBe("oauthAccessToken_token_idx");
			expect(
				resolvers.indexNameResolver({ model: "oauthAccessToken", field: "clientId" }),
			).toBe("oauthAccessToken_clientId_idx");
			expect(
				resolvers.indexNameResolver({ model: "oauthConsent", field: "userId" }),
			).toBe("oauthConsent_userId_idx");
		});

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

	describe("adapter integration", () => {
		const createPlugins = () => [
			jwt(),
			oauthProvider({
				loginPage: "/login",
				consentPage: "/consent",
			}),
		];

		// The fake is given the tables the adapter's index resolvers are derived from.
		const createClient = () =>
			createStatefulDocumentClient({
				tableSchemas: generateTableSchemas({ plugins: createPlugins() }),
				tableNamePrefix: "auth_",
			});

		const createAuthWithGSI = (
			documentClient: ReturnType<typeof createStatefulDocumentClient>["documentClient"],
		) => {
			const plugins = createPlugins();
			const schemas = generateTableSchemas({ plugins });
			const resolvers = createIndexResolversFromSchemas(schemas);

			return betterAuth({
				database: dynamodbAdapter({
					documentClient,
					tableNamePrefix: "auth_",
					transaction: false,
					scanMaxPages: 1,
					...resolvers,
				}),
				plugins,
				emailAndPassword: { enabled: true },
				secret: "test-secret-at-least-32-characters-long!!",
				baseURL: "http://localhost:3000",
				trustedOrigins: ["http://localhost:3000"],
			});
		};

		it("user signup works with oauthProvider plugin and proper resolvers", async () => {
			const { documentClient, store } = createClient();
			const auth = createAuthWithGSI(documentClient);

			await auth.api.signUpEmail({
				body: {
					email: "developer@example.com",
					password: "securepassword123",
					name: "Developer",
				},
			});

			const users = store.get("auth_user");
			expect(users.length).toBe(1);
			expect(users[0]).toHaveProperty("email", "developer@example.com");
		});

		it("signin uses QueryCommand for email lookup with proper resolvers", async () => {
			const { documentClient, sendCalls } = createClient();
			const auth = createAuthWithGSI(documentClient);

			await auth.api.signUpEmail({
				body: {
					email: "dev2@example.com",
					password: "securepassword123",
					name: "Dev2",
				},
			});

			sendCalls.length = 0;

			await auth.api.signInEmail({
				body: {
					email: "dev2@example.com",
					password: "securepassword123",
				},
			});

			const queryCalls = sendCalls.filter((c) => c instanceof QueryCommand);

			// With proper GSI, should use QueryCommand for email lookup
			expect(queryCalls.length).toBeGreaterThan(0);

			// Verify QueryCommand targets the email GSI
			const emailQuery = queryCalls.find((c) => {
				const cmd = c as QueryCommand;
				return cmd.input.IndexName === "user_email_idx";
			});
			expect(emailQuery).toBeDefined();
		});
	});
});
