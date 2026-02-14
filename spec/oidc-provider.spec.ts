/**
 * @file OIDC Provider plugin schema and index strategy tests.
 */
import { betterAuth } from "better-auth";
import { getAuthTables } from "@better-auth/core/db";
import { oidcProvider } from "better-auth/plugins";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { dynamodbAdapter } from "../src/adapter";
import { generateTableSchemas, createIndexResolversFromSchemas } from "../src";
import { createStatefulDocumentClient } from "./stateful-document-client";

describe("oidcProvider plugin", () => {
	const options = { plugins: [oidcProvider({ loginPage: "/login" })] };

	describe("oauthApplication table", () => {
		it("clientId(unique), userId(ref) → GSIs", () => {
			const authTables = getAuthTables(options);
			expect(authTables.oauthApplication.fields.clientId.unique).toBe(true);
			expect(authTables.oauthApplication.fields.userId.index).toBe(true);
			expect(authTables.oauthApplication.fields.userId.references?.model).toBe("user");

			const schemas = generateTableSchemas(options);
			const schema = schemas.find((s) => s.tableName === "oauthApplication");

			expect(schema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "clientId" }),
			);
			expect(schema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "userId" }),
			);
		});
	});

	describe("oauthAccessToken table", () => {
		it("accessToken(unique), refreshToken(unique), clientId(ref), userId(ref) → GSIs", () => {
			const authTables = getAuthTables(options);
			expect(authTables.oauthAccessToken.fields.accessToken.unique).toBe(true);
			expect(authTables.oauthAccessToken.fields.refreshToken.unique).toBe(true);
			expect(authTables.oauthAccessToken.fields.clientId.index).toBe(true);
			expect(authTables.oauthAccessToken.fields.clientId.references?.model).toBe(
				"oauthApplication",
			);
			expect(authTables.oauthAccessToken.fields.userId.index).toBe(true);
			expect(authTables.oauthAccessToken.fields.userId.references?.model).toBe("user");

			const schemas = generateTableSchemas(options);
			const schema = schemas.find((s) => s.tableName === "oauthAccessToken");

			expect(schema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "accessToken" }),
			);
			expect(schema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "refreshToken" }),
			);
			expect(schema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "clientId" }),
			);
			expect(schema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "userId" }),
			);
		});
	});

	describe("oauthConsent table", () => {
		it("clientId(ref), userId(ref) → GSIs", () => {
			const authTables = getAuthTables(options);
			expect(authTables.oauthConsent.fields.clientId.index).toBe(true);
			expect(authTables.oauthConsent.fields.clientId.references?.model).toBe(
				"oauthApplication",
			);
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
	});

	describe("index resolvers", () => {
		it("returns correct GSI names", () => {
			const schemas = generateTableSchemas(options);
			const resolvers = createIndexResolversFromSchemas(schemas);

			expect(
				resolvers.indexNameResolver({ model: "oauthApplication", field: "clientId" }),
			).toBe("oauthApplication_clientId_idx");
			expect(
				resolvers.indexNameResolver({ model: "oauthAccessToken", field: "accessToken" }),
			).toBe("oauthAccessToken_accessToken_idx");
			expect(
				resolvers.indexNameResolver({ model: "oauthAccessToken", field: "clientId" }),
			).toBe("oauthAccessToken_clientId_idx");
			expect(
				resolvers.indexNameResolver({ model: "oauthConsent", field: "userId" }),
			).toBe("oauthConsent_userId_idx");
		});
	});

	describe("adapter integration", () => {
		const createAuthWithGSI = (
			documentClient: ReturnType<typeof createStatefulDocumentClient>["documentClient"],
		) => {
			const schemas = generateTableSchemas(options);
			const resolvers = createIndexResolversFromSchemas(schemas);

			return betterAuth({
				database: dynamodbAdapter({
					documentClient,
					tableNamePrefix: "auth_",
					transaction: false,
					scanMaxPages: 1,
					...resolvers,
				}),
				plugins: [oidcProvider({ loginPage: "/login" })],
				emailAndPassword: { enabled: true },
				secret: "test-secret-at-least-32-characters-long!!",
				baseURL: "http://localhost:3000",
				trustedOrigins: ["http://localhost:3000"],
			});
		};

		it("user signup works with oidcProvider plugin and proper resolvers", async () => {
			const { documentClient, store } = createStatefulDocumentClient();
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
			const { documentClient, sendCalls } = createStatefulDocumentClient();
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
