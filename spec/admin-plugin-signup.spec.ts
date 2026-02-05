/**
 * @file Integration test: signup with admin plugin and transaction buffer.
 *
 * Verifies that the admin plugin's session.create.before hook can read a
 * user that was created in the same transaction via the buffer search,
 * preventing the "Cannot read properties of null (reading 'banned')" error.
 */
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins/admin";
import {
	BatchGetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { dynamodbAdapter } from "../src/adapter";
import { createDocumentClientStub } from "./dynamodb-document-client";

const createStubDocumentClient = () =>
	createDocumentClientStub({
		respond: async (command) => {
			if (command instanceof ScanCommand) {
				return { Items: [], LastEvaluatedKey: undefined };
			}
			if (command instanceof QueryCommand) {
				return { Items: [], LastEvaluatedKey: undefined };
			}
			if (command instanceof BatchGetCommand) {
				return { Responses: {} };
			}
			if (command instanceof TransactWriteCommand) {
				return {};
			}
			return {};
		},
	});

const createTestAdapter = (
	documentClient: ReturnType<typeof createStubDocumentClient>["documentClient"],
	transaction: boolean,
) =>
	dynamodbAdapter({
		documentClient,
		tableNamePrefix: "auth_",
		transaction,
		scanMaxPages: 1,
		indexNameResolver: () => undefined,
	});

describe("admin plugin signup with transaction", () => {
	test("signup succeeds when admin plugin checks user.banned within transaction", async () => {
		const { documentClient, sendCalls } = createStubDocumentClient();

		const auth = betterAuth({
			database: createTestAdapter(documentClient, true),
			plugins: [admin()],
			emailAndPassword: { enabled: true },
			secret: "test-secret-at-least-32-characters-long!!",
			baseURL: "http://localhost:3000",
			trustedOrigins: ["http://localhost:3000"],
		});

		const response = await auth.api.signUpEmail({
			body: {
				email: "alice@example.com",
				password: "securepassword123",
				name: "Alice",
			},
		});

		// Signup should succeed (admin plugin found the user in the buffer)
		expect(response).toBeDefined();

		const body: { token: string | null; user: { email: string } } = response;
		expect(body.user.email).toBe("alice@example.com");

		// Transaction should have been committed
		const transactCommands = sendCalls.filter(
			(c) => c instanceof TransactWriteCommand,
		);
		expect(transactCommands.length).toBe(1);

		// findUserById should NOT have hit DynamoDB (resolved from buffer)
		// Only findUserByEmail (before user create) should have queried DynamoDB
		const isScanOrQuery = (c: unknown): boolean => {
			if (c instanceof ScanCommand) {
				return true;
			}
			if (c instanceof QueryCommand) {
				return true;
			}
			return c instanceof BatchGetCommand;
		};
		const readCommands = sendCalls.filter(isScanOrQuery);
		// At most: findUserByEmail scan (user doesn't exist yet)
		expect(readCommands.length).toBeLessThanOrEqual(1);
	});

	test("user.create.after hook receives valid user data for external sync", async () => {
		const { documentClient } = createStubDocumentClient();

		const capturedUsers: Record<string, unknown>[] = [];

		const auth = betterAuth({
			database: createTestAdapter(documentClient, true),
			plugins: [admin()],
			emailAndPassword: { enabled: true },
			secret: "test-secret-at-least-32-characters-long!!",
			baseURL: "http://localhost:3000",
			trustedOrigins: ["http://localhost:3000"],
			databaseHooks: {
				user: {
					create: {
						after: async (user) => {
							// Simulate onUserCreated sync (e.g., PG write)
							capturedUsers.push(user);
						},
					},
				},
			},
		});

		await auth.api.signUpEmail({
			body: {
				email: "bob@example.com",
				password: "securepassword123",
				name: "Bob",
			},
		});

		// Hook should have fired exactly once
		expect(capturedUsers.length).toBe(1);

		const user = capturedUsers[0];
		// User data must contain the essential fields for external sync
		expect(user.id).toBeDefined();
		expect(typeof user.id).toBe("string");
		expect(user.email).toBe("bob@example.com");
		expect(user.name).toBe("Bob");
		expect(user.createdAt).toBeDefined();
	});
});

describe("admin plugin signup without transaction", () => {
	/**
	 * When transaction is false, writes go to DynamoDB immediately via
	 * PutCommand. The stub stores created items so subsequent reads
	 * (BatchGet/Scan/Query) can find them, mimicking real DynamoDB.
	 */
	const createStatefulStubDocumentClient = () => {
		const store = new Map<string, Record<string, unknown>[]>();
		const addToStore = (tableName: string, item: Record<string, unknown>) => {
			const items = store.get(tableName);
			if (items) {
				items.push(item);
			} else {
				store.set(tableName, [item]);
			}
		};
		const getFromStore = (tableName: string): Record<string, unknown>[] =>
			store.get(tableName) ?? [];

		return createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof PutCommand) {
					const tableName = command.input.TableName ?? "";
					const item = command.input.Item ?? {};
					addToStore(tableName, item as Record<string, unknown>);
					return {};
				}
				if (command instanceof BatchGetCommand) {
					const requestItems = command.input.RequestItems ?? {};
					const responses: Record<string, Record<string, unknown>[]> = {};
					for (const [tableName, request] of Object.entries(requestItems)) {
						const keys = request.Keys ?? [];
						const items = getFromStore(tableName);
						responses[tableName] = items.filter((item) =>
							keys.some((key) => {
								const keyEntries = Object.entries(key);
								return keyEntries.every(
									([k, v]) => item[k] === v,
								);
							}),
						);
					}
					return { Responses: responses };
				}
				if (command instanceof ScanCommand) {
					const tableName = command.input.TableName ?? "";
					return {
						Items: getFromStore(tableName),
						LastEvaluatedKey: undefined,
					};
				}
				if (command instanceof QueryCommand) {
					const tableName = command.input.TableName ?? "";
					return {
						Items: getFromStore(tableName),
						LastEvaluatedKey: undefined,
					};
				}
				return {};
			},
		});
	};

	test("signup succeeds without transaction mode", async () => {
		const { documentClient, sendCalls } = createStatefulStubDocumentClient();

		const auth = betterAuth({
			database: createTestAdapter(documentClient, false),
			plugins: [admin()],
			emailAndPassword: { enabled: true },
			secret: "test-secret-at-least-32-characters-long!!",
			baseURL: "http://localhost:3000",
			trustedOrigins: ["http://localhost:3000"],
		});

		const response = await auth.api.signUpEmail({
			body: {
				email: "charlie@example.com",
				password: "securepassword123",
				name: "Charlie",
			},
		});

		expect(response).toBeDefined();

		const body: { token: string | null; user: { email: string } } = response;
		expect(body.user.email).toBe("charlie@example.com");

		// No TransactWriteCommand should be used
		const transactCommands = sendCalls.filter(
			(c) => c instanceof TransactWriteCommand,
		);
		expect(transactCommands.length).toBe(0);

		// PutCommand should have been used for direct writes
		const putCommands = sendCalls.filter(
			(c) => c instanceof PutCommand,
		);
		expect(putCommands.length).toBeGreaterThan(0);
	});

	test("user.create.after hook receives valid user data without transaction", async () => {
		const { documentClient } = createStatefulStubDocumentClient();

		const capturedUsers: Record<string, unknown>[] = [];

		const auth = betterAuth({
			database: createTestAdapter(documentClient, false),
			plugins: [admin()],
			emailAndPassword: { enabled: true },
			secret: "test-secret-at-least-32-characters-long!!",
			baseURL: "http://localhost:3000",
			trustedOrigins: ["http://localhost:3000"],
			databaseHooks: {
				user: {
					create: {
						after: async (user) => {
							capturedUsers.push(user);
						},
					},
				},
			},
		});

		await auth.api.signUpEmail({
			body: {
				email: "dave@example.com",
				password: "securepassword123",
				name: "Dave",
			},
		});

		expect(capturedUsers.length).toBe(1);

		const user = capturedUsers[0];
		expect(user.id).toBeDefined();
		expect(typeof user.id).toBe("string");
		expect(user.email).toBe("dave@example.com");
		expect(user.name).toBe("Dave");
		expect(user.createdAt).toBeDefined();
	});
});
