/**
 * @file Integration tests for the API Key plugin with DynamoDB adapter.
 */
import { betterAuth } from "better-auth";
import { apiKey } from "better-auth/plugins";
import { PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { dynamodbAdapter } from "../src/adapter";
import { createStatefulDocumentClient } from "./stateful-document-client";
import { signUpAndGetHeaders } from "./plugin-test-utils";
import {
	generateTableSchemas,
	createIndexResolversFromSchemas,
} from "../src/table-schemas";

const plugins = [apiKey()];
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

describe("API Key plugin (transaction: true)", () => {
	test("creates an API key for authenticated user", async () => {
		const { documentClient } = createStatefulDocumentClient();
		const auth = createAuth(documentClient, true);

		const { headers } = await signUpAndGetHeaders(
			auth,
			"alice@example.com",
			"Alice",
		);

		const result = await auth.api.createApiKey({
			body: { name: "test-key" },
			headers,
		});

		expect(result).toBeDefined();
		expect(result.name).toBe("test-key");
		expect(result.id).toBeDefined();
	});

	test("lists API keys after creation", async () => {
		const { documentClient } = createStatefulDocumentClient();
		const auth = createAuth(documentClient, true);

		const { headers } = await signUpAndGetHeaders(
			auth,
			"bob@example.com",
			"Bob",
		);

		await auth.api.createApiKey({
			body: { name: "key-1" },
			headers,
		});

		const list = await auth.api.listApiKeys({ headers });

		expect(Array.isArray(list)).toBe(true);
		expect(list.length).toBeGreaterThanOrEqual(1);
		expect(list.some((k) => k.name === "key-1")).toBe(true);
	});
});

describe("API Key plugin (transaction: false)", () => {
	test("creates an API key for authenticated user", async () => {
		const { documentClient, sendCalls } = createStatefulDocumentClient();
		const auth = createAuth(documentClient, false);

		const { headers } = await signUpAndGetHeaders(
			auth,
			"charlie@example.com",
			"Charlie",
		);

		const result = await auth.api.createApiKey({
			body: { name: "test-key" },
			headers,
		});

		expect(result).toBeDefined();
		expect(result.name).toBe("test-key");
		expect(result.id).toBeDefined();

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

	test("lists API keys using QueryCommand with apiKey_userId GSI", async () => {
		const { documentClient, sendCalls } = createStatefulDocumentClient();
		const auth = createAuth(documentClient, false);

		const { headers } = await signUpAndGetHeaders(
			auth,
			"dave@example.com",
			"Dave",
		);

		await auth.api.createApiKey({
			body: { name: "key-1" },
			headers,
		});

		// Clear sendCalls to track only listApiKeys
		sendCalls.length = 0;

		const list = await auth.api.listApiKeys({ headers });

		expect(Array.isArray(list)).toBe(true);
		expect(list.length).toBeGreaterThanOrEqual(1);
		expect(list.some((k) => k.name === "key-1")).toBe(true);

		// Verify QueryCommand was used with apikey_userId_idx GSI (table name is lowercase)
		const queryCalls = sendCalls.filter((c) => c instanceof QueryCommand);
		const apiKeyQuery = queryCalls.find((c) => {
			const cmd = c as QueryCommand;
			return cmd.input.IndexName === "apikey_userId_idx";
		});
		expect(apiKeyQuery).toBeDefined();
	});
});
