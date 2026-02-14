/**
 * @file Integration tests for the Username plugin with DynamoDB adapter.
 *
 * Username plugin adds:
 * - user.username field (unique) -> GSI
 * - user.displayUsername field (not indexed)
 */
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { dynamodbAdapter } from "../src/adapter";
import {
	generateTableSchemas,
	createIndexResolversFromSchemas,
} from "../src/table-schemas";
import { createStatefulDocumentClient } from "./stateful-document-client";

const plugins = [username()];
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

describe("username plugin", () => {
	describe("schema generation", () => {
		it("does not create new tables", () => {
			const schemasWithout = generateTableSchemas({});
			const schemasWith = generateTableSchemas({ plugins: [username()] });

			expect(schemasWith.length).toBe(schemasWithout.length);
		});

		it("user table has GSI for username (unique)", () => {
			const schemas = generateTableSchemas({ plugins: [username()] });
			const userSchema = schemas.find((s) => s.tableName === "user");

			expect(userSchema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "username" }),
			);
		});

		it("user table does not have GSI for displayUsername (not indexed)", () => {
			const schemas = generateTableSchemas({ plugins: [username()] });
			const userSchema = schemas.find((s) => s.tableName === "user");

			expect(userSchema?.indexMappings).not.toContainEqual(
				expect.objectContaining({ partitionKey: "displayUsername" }),
			);
		});
	});

	describe("adapter integration", () => {
		it("creates user with username", async () => {
			const { documentClient, store } = createStatefulDocumentClient();
			const auth = createAuth(documentClient, true);

			await auth.api.signUpEmail({
				body: {
					email: "alice@example.com",
					password: "securepassword123",
					name: "Alice",
					username: "alice123",
				},
			});

			const users = store.get("auth_user");
			expect(users.length).toBe(1);
			expect(users[0]).toHaveProperty("username", "alice123");
		});

		it("uses QueryCommand with user_username_idx GSI for signInUsername", async () => {
			const { documentClient, sendCalls } = createStatefulDocumentClient();
			const auth = createAuth(documentClient, false);

			// Create user with username first
			await auth.api.signUpEmail({
				body: {
					email: "bob@example.com",
					password: "securepassword123",
					name: "Bob",
					username: "bob456",
				},
			});

			// Clear sendCalls to track only signInUsername
			sendCalls.length = 0;

			// Sign in with username
			await auth.api.signInUsername({
				body: {
					username: "bob456",
					password: "securepassword123",
				},
			});

			// Verify QueryCommand was used with user_username_idx GSI
			const queryCalls = sendCalls.filter((c) => c instanceof QueryCommand);
			const usernameQuery = queryCalls.find((c) => {
				const cmd = c as QueryCommand;
				return cmd.input.IndexName === "user_username_idx";
			});
			expect(usernameQuery).toBeDefined();
		});
	});
});
