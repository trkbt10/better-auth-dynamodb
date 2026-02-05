/**
 * @file Integration tests for the Two-Factor plugin with DynamoDB adapter.
 */
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { admin } from "better-auth/plugins/admin";
import { PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { dynamodbAdapter } from "../src/adapter";
import { createStatefulDocumentClient } from "./stateful-document-client";
import { signUpAndGetHeaders } from "./plugin-test-utils";

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
			indexNameResolver: () => undefined,
		}),
		plugins: [twoFactor(), admin()],
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
});
