/**
 * @file Integration tests for the Two-Factor plugin with DynamoDB adapter.
 *
 * Two Factor plugin adds:
 * - twoFactor table with userId (index, references user.id) and secret (index)
 * - user.twoFactorEnabled field (not indexed)
 */
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { admin } from "better-auth/plugins/admin";
import { PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { dynamodbAdapter } from "../src/adapter";
import { createStatefulDocumentClient } from "./stateful-document-client";
import { signUpAndGetHeaders } from "./plugin-test-utils";
import {
	generateTableSchemas,
	createIndexResolversFromSchemas,
} from "../src/table-schemas";

const plugins = [twoFactor(), admin()];
const schemas = generateTableSchemas({ plugins });
const resolvers = createIndexResolversFromSchemas(schemas);

const createAuth = (
	documentClient: ReturnType<typeof createStatefulDocumentClient>["documentClient"],
	transaction: boolean,
) =>
	betterAuth({
		database: dynamodbAdapter({
			documentClient,
			tableNamePrefix: "auth_",
			transaction,
			scanMaxPages: 1,
			...resolvers,
		}),
		plugins,
		emailAndPassword: { enabled: true },
		secret: "test-secret-at-least-32-characters-long!!",
		baseURL: "http://localhost:3000",
		trustedOrigins: ["http://localhost:3000"],
	});

describe("Two-Factor plugin (transaction: true)", () => {
	test("enables two-factor authentication for user", async () => {
		const { documentClient } = createStatefulDocumentClient();
		const auth = createAuth(documentClient, true);

		const { headers } = await signUpAndGetHeaders(
			auth,
			"alice@example.com",
			"Alice",
		);

		const result = await auth.api.enableTwoFactor({
			body: { password: "securepassword123" },
			headers,
		});

		expect(result).toBeDefined();
		expect(result.totpURI).toBeDefined();
		expect(typeof result.totpURI).toBe("string");
		expect(result.backupCodes).toBeDefined();
		expect(Array.isArray(result.backupCodes)).toBe(true);
	});

	test("signup succeeds with two-factor plugin enabled", async () => {
		const { documentClient } = createStatefulDocumentClient();
		const auth = createAuth(documentClient, true);

		const { user } = await signUpAndGetHeaders(
			auth,
			"bob@example.com",
			"Bob",
		);

		expect(user.email).toBe("bob@example.com");
		expect(user.name).toBe("Bob");
	});
});

describe("Two-Factor plugin (transaction: false)", () => {
	test("enables two-factor authentication for user", async () => {
		const { documentClient, sendCalls } = createStatefulDocumentClient();
		const auth = createAuth(documentClient, false);

		const { headers } = await signUpAndGetHeaders(
			auth,
			"charlie@example.com",
			"Charlie",
		);

		const result = await auth.api.enableTwoFactor({
			body: { password: "securepassword123" },
			headers,
		});

		expect(result).toBeDefined();
		expect(result.totpURI).toBeDefined();
		expect(result.backupCodes).toBeDefined();

		// No transactions used
		const transactCommands = sendCalls.filter(
			(c) => c instanceof TransactWriteCommand,
		);
		expect(transactCommands.length).toBe(0);

		// Direct PutCommand writes used
		const putCommands = sendCalls.filter(
			(c) => c instanceof PutCommand,
		);
		expect(putCommands.length).toBeGreaterThan(0);
	});

	test("signup succeeds with two-factor plugin enabled", async () => {
		const { documentClient } = createStatefulDocumentClient();
		const auth = createAuth(documentClient, false);

		const { user } = await signUpAndGetHeaders(
			auth,
			"dave@example.com",
			"Dave",
		);

		expect(user.email).toBe("dave@example.com");
		expect(user.name).toBe("Dave");
	});

	test("uses QueryCommand with userId GSI when enabling two-factor", async () => {
		const { documentClient, sendCalls } = createStatefulDocumentClient();
		const auth = createAuth(documentClient, false);

		const { headers } = await signUpAndGetHeaders(
			auth,
			"eve@example.com",
			"Eve",
		);

		// Clear sendCalls to track enableTwoFactor operation
		sendCalls.length = 0;

		// Enable two-factor - this queries twoFactor table by userId to check existing
		await auth.api.enableTwoFactor({
			body: { password: "securepassword123" },
			headers,
		});

		// Verify QueryCommand was used with twoFactor_userId_idx GSI
		const queryCalls = sendCalls.filter((c) => c instanceof QueryCommand);
		const twoFactorQuery = queryCalls.find((c) => {
			const cmd = c as QueryCommand;
			return cmd.input.IndexName === "twoFactor_userId_idx";
		});
		expect(twoFactorQuery).toBeDefined();
	});
});

describe("twoFactor plugin schema generation", () => {
	it("creates twoFactor table", () => {
		const schemas = generateTableSchemas({
			plugins: [twoFactor()],
		});
		const tableNames = schemas.map((s) => s.tableName);

		expect(tableNames).toContain("twoFactor");
	});

	it("twoFactor table has GSI for userId (index + references)", () => {
		const schemas = generateTableSchemas({
			plugins: [twoFactor()],
		});
		const twoFactorSchema = schemas.find((s) => s.tableName === "twoFactor");

		expect(twoFactorSchema?.indexMappings).toContainEqual(
			expect.objectContaining({ partitionKey: "userId" }),
		);
	});

	it("twoFactor table has GSI for secret (index)", () => {
		const schemas = generateTableSchemas({
			plugins: [twoFactor()],
		});
		const twoFactorSchema = schemas.find((s) => s.tableName === "twoFactor");

		expect(twoFactorSchema?.indexMappings).toContainEqual(
			expect.objectContaining({ partitionKey: "secret" }),
		);
	});
});
