/**
 * @file Integration test: signup with admin plugin and transaction buffer.
 *
 * Verifies that the admin plugin's session.create.before hook can read a
 * user that was created in the same transaction via the buffer search,
 * preventing the "Cannot read properties of null (reading 'banned')" error.
 */
import { admin } from "better-auth/plugins/admin";
import {
	BatchGetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { createDocumentClientStub } from "./dynamodb-document-client";
import { createStatefulDocumentClient } from "./stateful-document-client";
import { createTestAuth } from "./plugin-test-utils";

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

describe("admin plugin signup with transaction", () => {
	test("signup succeeds when admin plugin checks user.banned within transaction", async () => {
		const { documentClient, sendCalls } = createStubDocumentClient();

		const auth = createTestAuth({
			documentClient,
			transaction: true,
			plugins: [admin()],
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

		const auth = createTestAuth({
			documentClient,
			transaction: true,
			plugins: [admin()],
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
	test("signup succeeds without transaction mode", async () => {
		const { documentClient, sendCalls } = createStatefulDocumentClient();

		const auth = createTestAuth({
			documentClient,
			transaction: false,
			plugins: [admin()],
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
		const { documentClient } = createStatefulDocumentClient();

		const capturedUsers: Record<string, unknown>[] = [];

		const auth = createTestAuth({
			documentClient,
			transaction: false,
			plugins: [admin()],
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
