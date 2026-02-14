/**
 * @file Integration tests for the Anonymous plugin with DynamoDB adapter.
 *
 * Anonymous plugin adds:
 * - user.isAnonymous field (not indexed)
 */
import { betterAuth } from "better-auth";
import { anonymous } from "better-auth/plugins";
import { dynamodbAdapter } from "../src/adapter";
import {
	generateTableSchemas,
	createIndexResolversFromSchemas,
} from "../src/table-schemas";
import { createStatefulDocumentClient } from "./stateful-document-client";

const plugins = [anonymous()];
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

describe("anonymous plugin", () => {
	describe("schema generation", () => {
		it("does not create new tables", () => {
			const schemasWithout = generateTableSchemas({});
			const schemasWith = generateTableSchemas({ plugins: [anonymous()] });

			expect(schemasWith.length).toBe(schemasWithout.length);
		});

		it("user table GSI count unchanged (isAnonymous not indexed)", () => {
			const schemasWithout = generateTableSchemas({});
			const schemasWith = generateTableSchemas({ plugins: [anonymous()] });

			const userWithout = schemasWithout.find((s) => s.tableName === "user");
			const userWith = schemasWith.find((s) => s.tableName === "user");

			expect(userWith?.indexMappings.length).toBe(userWithout?.indexMappings.length);
		});
	});

	describe("adapter integration", () => {
		it("creates anonymous user", async () => {
			const { documentClient, store } = createStatefulDocumentClient();
			const auth = createAuth(documentClient, true);

			const result = await auth.api.signInAnonymous();

			expect(result).not.toBeNull();
			expect(result?.user).toBeDefined();

			const users = store.get("auth_user");
			expect(users.length).toBe(1);
			expect(users[0]).toHaveProperty("isAnonymous", true);
		});
	});
});
