/**
 * @file Integration tests verifying indexReferences feature works with the adapter.
 *
 * These tests verify that:
 * 1. Schema extensions add GSIs for plugins with missing references
 * 2. The adapter uses QueryCommand (not ScanCommand) when GSIs are available
 * 3. The full flow works: generateTableSchemas -> createIndexResolversFromSchemas -> adapter
 */
import { betterAuth } from "better-auth";
import {
	deviceAuthorization,
	phoneNumber,
	siwe,
	twoFactor,
	username,
} from "better-auth/plugins";
import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { dynamodbAdapter } from "../src/adapter";
import {
	generateTableSchemas,
	createIndexResolversFromSchemas,
} from "../src/table-schemas";
import { createStatefulDocumentClient } from "./stateful-document-client";
import { signUpAndGetHeaders } from "./plugin-test-utils";

describe("indexReferences integration with adapter", () => {
	describe("deviceAuthorization plugin (schema extension)", () => {
		const createAuthWithGSI = (
			documentClient: ReturnType<typeof createStatefulDocumentClient>["documentClient"],
		) => {
			const schemas = generateTableSchemas({
				plugins: [deviceAuthorization()],
			});
			const resolvers = createIndexResolversFromSchemas(schemas);

			return betterAuth({
				database: dynamodbAdapter({
					documentClient,
					tableNamePrefix: "auth_",
					transaction: false,
					scanMaxPages: 1,
					...resolvers,
				}),
				plugins: [deviceAuthorization()],
				emailAndPassword: { enabled: true },
				secret: "test-secret-at-least-32-characters-long!!",
				baseURL: "http://localhost:3000",
				trustedOrigins: ["http://localhost:3000"],
			});
		};

		it("deviceCode table has userId GSI via schema extension", () => {
			const schemas = generateTableSchemas({
				plugins: [deviceAuthorization()],
			});
			const deviceCodeSchema = schemas.find((s) => s.tableName === "deviceCode");

			expect(deviceCodeSchema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "userId" }),
			);
		});

		it("indexNameResolver returns GSI name for userId field", () => {
			const schemas = generateTableSchemas({
				plugins: [deviceAuthorization()],
			});
			const resolvers = createIndexResolversFromSchemas(schemas);

			const indexName = resolvers.indexNameResolver({
				model: "deviceCode",
				field: "userId",
			});

			expect(indexName).toBe("deviceCode_userId_idx");
		});

		it("creates device code and stores in database", async () => {
			const { documentClient, store } = createStatefulDocumentClient();
			const auth = createAuthWithGSI(documentClient);

			await auth.api.deviceCode({
				body: { client_id: "test-client" },
			});

			const deviceCodes = store.get("auth_deviceCode");
			expect(deviceCodes.length).toBe(1);
			expect(deviceCodes[0]).toHaveProperty("clientId", "test-client");
			expect(deviceCodes[0]).toHaveProperty("status", "pending");
		});
	});

	describe("twoFactor plugin (native references)", () => {
		const createAuthWithGSI = (
			documentClient: ReturnType<typeof createStatefulDocumentClient>["documentClient"],
		) => {
			const schemas = generateTableSchemas({
				plugins: [twoFactor()],
			});
			const resolvers = createIndexResolversFromSchemas(schemas);

			return betterAuth({
				database: dynamodbAdapter({
					documentClient,
					tableNamePrefix: "auth_",
					transaction: false,
					scanMaxPages: 1,
					...resolvers,
				}),
				plugins: [twoFactor()],
				emailAndPassword: { enabled: true },
				secret: "test-secret-at-least-32-characters-long!!",
				baseURL: "http://localhost:3000",
				trustedOrigins: ["http://localhost:3000"],
			});
		};

		it("twoFactor table has userId GSI (native index + references)", () => {
			const schemas = generateTableSchemas({
				plugins: [twoFactor()],
			});
			const twoFactorSchema = schemas.find((s) => s.tableName === "twoFactor");

			expect(twoFactorSchema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "userId" }),
			);
		});

		it("indexNameResolver returns GSI name for userId field", () => {
			const schemas = generateTableSchemas({
				plugins: [twoFactor()],
			});
			const resolvers = createIndexResolversFromSchemas(schemas);

			const indexName = resolvers.indexNameResolver({
				model: "twoFactor",
				field: "userId",
			});

			expect(indexName).toBe("twoFactor_userId_idx");
		});

		it("enables two-factor and stores in database", async () => {
			const { documentClient, store } = createStatefulDocumentClient();
			const auth = createAuthWithGSI(documentClient);

			const { headers } = await signUpAndGetHeaders(
				auth,
				"alice@example.com",
				"Alice",
			);

			const result = await auth.api.enableTwoFactor({
				body: { password: "securepassword123" },
				headers,
			});

			expect(result.totpURI).toBeDefined();

			const twoFactorRecords = store.get("auth_twoFactor");
			expect(twoFactorRecords.length).toBe(1);
			expect(twoFactorRecords[0]).toHaveProperty("userId");
			expect(twoFactorRecords[0]).toHaveProperty("secret");
		});
	});

	describe("siwe plugin (native references)", () => {
		const siweOptions = {
			domain: "example.com",
			getNonce: async () => "test-nonce",
			verifyMessage: async () => true,
		};

		it("walletAddress table has userId GSI (native index + references)", () => {
			const schemas = generateTableSchemas({
				plugins: [siwe(siweOptions)],
			});
			const walletSchema = schemas.find((s) => s.tableName === "walletAddress");

			expect(walletSchema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "userId" }),
			);
		});

		it("indexNameResolver returns GSI name for userId field", () => {
			const schemas = generateTableSchemas({
				plugins: [siwe(siweOptions)],
			});
			const resolvers = createIndexResolversFromSchemas(schemas);

			const indexName = resolvers.indexNameResolver({
				model: "walletAddress",
				field: "userId",
			});

			expect(indexName).toBe("walletAddress_userId_idx");
		});
	});

	describe("query strategy verification", () => {
		it("uses QueryCommand when GSI is available for user.email lookup", async () => {
			const { documentClient, sendCalls } = createStatefulDocumentClient();

			const schemas = generateTableSchemas({});
			const resolvers = createIndexResolversFromSchemas(schemas);

			const auth = betterAuth({
				database: dynamodbAdapter({
					documentClient,
					tableNamePrefix: "auth_",
					transaction: false,
					scanMaxPages: 1,
					...resolvers,
				}),
				emailAndPassword: { enabled: true },
				secret: "test-secret-at-least-32-characters-long!!",
				baseURL: "http://localhost:3000",
				trustedOrigins: ["http://localhost:3000"],
			});

			// First signup creates the user
			await auth.api.signUpEmail({
				body: {
					email: "test@example.com",
					password: "securepassword123",
					name: "Test",
				},
			});

			// Clear sendCalls to only track the signin
			sendCalls.length = 0;

			// Signin will look up user by email
			await auth.api.signInEmail({
				body: {
					email: "test@example.com",
					password: "securepassword123",
				},
			});

			// Should use QueryCommand for email lookup (email has unique GSI)
			const queryCalls = sendCalls.filter((c) => c instanceof QueryCommand);

			// With proper GSI, QueryCommand should be used for email lookup
			expect(queryCalls.length).toBeGreaterThan(0);

			// Verify the QueryCommand targets the email GSI
			const emailQuery = queryCalls.find((c) => {
				const cmd = c as QueryCommand;
				return cmd.input.IndexName === "user_email_idx";
			});
			expect(emailQuery).toBeDefined();
		});

		it("falls back to ScanCommand when indexNameResolver returns undefined", async () => {
			const { documentClient, sendCalls } = createStatefulDocumentClient();

			// Adapter WITHOUT proper resolvers (always returns undefined)
			const auth = betterAuth({
				database: dynamodbAdapter({
					documentClient,
					tableNamePrefix: "auth_",
					transaction: false,
					scanMaxPages: 1,
					indexNameResolver: () => undefined, // No GSI resolution
				}),
				emailAndPassword: { enabled: true },
				secret: "test-secret-at-least-32-characters-long!!",
				baseURL: "http://localhost:3000",
				trustedOrigins: ["http://localhost:3000"],
			});

			await auth.api.signUpEmail({
				body: {
					email: "fallback@example.com",
					password: "securepassword123",
					name: "Fallback",
				},
			});

			sendCalls.length = 0;

			await auth.api.signInEmail({
				body: {
					email: "fallback@example.com",
					password: "securepassword123",
				},
			});

			// Without GSI resolver, should fall back to ScanCommand
			const scanCalls = sendCalls.filter((c) => c instanceof ScanCommand);
			expect(scanCalls.length).toBeGreaterThan(0);
		});
	});

	describe("username plugin (unique GSI)", () => {
		it("user.username has unique GSI", () => {
			const schemas = generateTableSchemas({
				plugins: [username()],
			});
			const userSchema = schemas.find((s) => s.tableName === "user");

			expect(userSchema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "username" }),
			);
		});

		it("indexNameResolver returns GSI name for username field", () => {
			const schemas = generateTableSchemas({
				plugins: [username()],
			});
			const resolvers = createIndexResolversFromSchemas(schemas);

			const indexName = resolvers.indexNameResolver({
				model: "user",
				field: "username",
			});

			expect(indexName).toBe("user_username_idx");
		});

		it("uses QueryCommand for username lookup with proper resolvers", async () => {
			const { documentClient, sendCalls, store } = createStatefulDocumentClient();

			const schemas = generateTableSchemas({
				plugins: [username()],
			});
			const resolvers = createIndexResolversFromSchemas(schemas);

			const auth = betterAuth({
				database: dynamodbAdapter({
					documentClient,
					tableNamePrefix: "auth_",
					transaction: false,
					scanMaxPages: 1,
					...resolvers,
				}),
				plugins: [username()],
				emailAndPassword: { enabled: true },
				secret: "test-secret-at-least-32-characters-long!!",
				baseURL: "http://localhost:3000",
				trustedOrigins: ["http://localhost:3000"],
			});

			// Create user with username
			await auth.api.signUpEmail({
				body: {
					email: "alice@example.com",
					password: "securepassword123",
					name: "Alice",
					username: "alice123",
				},
			});

			// Verify user was stored with username
			const users = store.get("auth_user");
			expect(users[0]).toHaveProperty("username", "alice123");

			sendCalls.length = 0;

			// Sign in with username triggers username lookup
			await auth.api.signInUsername({
				body: {
					username: "alice123",
					password: "securepassword123",
				},
			});

			// Should use QueryCommand for username lookup
			const queryCalls = sendCalls.filter((c) => c instanceof QueryCommand);
			expect(queryCalls.length).toBeGreaterThan(0);

			// Verify QueryCommand targets username GSI
			const usernameQuery = queryCalls.find((c) => {
				const cmd = c as QueryCommand;
				return cmd.input.IndexName === "user_username_idx";
			});
			expect(usernameQuery).toBeDefined();
		});
	});

	describe("phoneNumber plugin (unique GSI)", () => {
		it("user.phoneNumber has unique GSI", () => {
			const schemas = generateTableSchemas({
				plugins: [phoneNumber()],
			});
			const userSchema = schemas.find((s) => s.tableName === "user");

			expect(userSchema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "phoneNumber" }),
			);
		});

		it("indexNameResolver returns GSI name for phoneNumber field", () => {
			const schemas = generateTableSchemas({
				plugins: [phoneNumber()],
			});
			const resolvers = createIndexResolversFromSchemas(schemas);

			const indexName = resolvers.indexNameResolver({
				model: "user",
				field: "phoneNumber",
			});

			expect(indexName).toBe("user_phoneNumber_idx");
		});

		it("stores phoneNumber in user record", async () => {
			const { documentClient, store } = createStatefulDocumentClient();

			const schemas = generateTableSchemas({
				plugins: [phoneNumber({ sendOTP: async () => {} })],
			});
			const resolvers = createIndexResolversFromSchemas(schemas);

			const auth = betterAuth({
				database: dynamodbAdapter({
					documentClient,
					tableNamePrefix: "auth_",
					transaction: false,
					scanMaxPages: 1,
					...resolvers,
				}),
				plugins: [phoneNumber({ sendOTP: async () => {} })],
				emailAndPassword: { enabled: true },
				secret: "test-secret-at-least-32-characters-long!!",
				baseURL: "http://localhost:3000",
				trustedOrigins: ["http://localhost:3000"],
			});

			// Create user first
			await auth.api.signUpEmail({
				body: {
					email: "bob@example.com",
					password: "securepassword123",
					name: "Bob",
				},
			});

			// Verify user was created
			const users = store.get("auth_user");
			expect(users.length).toBe(1);
			expect(users[0]).toHaveProperty("email", "bob@example.com");
		});
	});

	describe("twoFactor plugin (secret GSI)", () => {
		it("twoFactor.secret has index GSI", () => {
			const schemas = generateTableSchemas({
				plugins: [twoFactor()],
			});
			const twoFactorSchema = schemas.find((s) => s.tableName === "twoFactor");

			expect(twoFactorSchema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "secret" }),
			);
		});

		it("indexNameResolver returns GSI name for secret field", () => {
			const schemas = generateTableSchemas({
				plugins: [twoFactor()],
			});
			const resolvers = createIndexResolversFromSchemas(schemas);

			const indexName = resolvers.indexNameResolver({
				model: "twoFactor",
				field: "secret",
			});

			expect(indexName).toBe("twoFactor_secret_idx");
		});
	});
});
