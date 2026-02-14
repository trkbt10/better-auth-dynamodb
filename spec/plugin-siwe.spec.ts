/**
 * @file Integration tests for the SIWE (Sign In With Ethereum) plugin with DynamoDB adapter.
 *
 * SIWE plugin adds:
 * - walletAddress table with userId (index, references user.id)
 */
import { betterAuth } from "better-auth";
import { siwe } from "better-auth/plugins";
import { dynamodbAdapter } from "../src/adapter";
import {
	generateTableSchemas,
	createIndexResolversFromSchemas,
} from "../src/table-schemas";
import { createStatefulDocumentClient } from "./stateful-document-client";

const siweOptions = {
	domain: "example.com",
	getNonce: async () => "test-nonce",
	verifyMessage: async () => true,
};

const plugins = [siwe(siweOptions)];
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

describe("siwe plugin", () => {
	describe("schema generation", () => {
		it("creates walletAddress table", () => {
			const schemas = generateTableSchemas({
				plugins: [siwe(siweOptions)],
			});
			const tableNames = schemas.map((s) => s.tableName);

			expect(tableNames).toContain("walletAddress");
		});

		it("walletAddress table has GSI for userId (index + references)", () => {
			const schemas = generateTableSchemas({
				plugins: [siwe(siweOptions)],
			});
			const walletSchema = schemas.find((s) => s.tableName === "walletAddress");

			expect(walletSchema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "userId" }),
			);
		});
	});

	describe("adapter integration", () => {
		it("user signup works with siwe plugin enabled", async () => {
			const { documentClient, store } = createStatefulDocumentClient();
			const auth = createAuth(documentClient, true);

			await auth.api.signUpEmail({
				body: {
					email: "alice@example.com",
					password: "securepassword123",
					name: "Alice",
				},
			});

			const users = store.get("auth_user");
			expect(users.length).toBe(1);
			expect(users[0]).toHaveProperty("email", "alice@example.com");
		});
	});
});
