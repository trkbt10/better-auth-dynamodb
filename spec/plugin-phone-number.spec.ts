/**
 * @file Integration tests for the Phone Number plugin with DynamoDB adapter.
 *
 * Phone Number plugin adds:
 * - user.phoneNumber field (unique) -> GSI
 * - user.phoneNumberVerified field (not indexed)
 */
import { betterAuth } from "better-auth";
import { phoneNumber } from "better-auth/plugins";
import { dynamodbAdapter } from "../src/adapter";
import {
	generateTableSchemas,
	createIndexResolversFromSchemas,
} from "../src/table-schemas";
import { createStatefulDocumentClient } from "./stateful-document-client";

const plugins = [
	phoneNumber({
		sendOTP: async () => {},
	}),
];
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

describe("phoneNumber plugin", () => {
	describe("schema generation", () => {
		it("does not create new tables", () => {
			const schemasWithout = generateTableSchemas({});
			const schemasWith = generateTableSchemas({ plugins: [phoneNumber()] });

			expect(schemasWith.length).toBe(schemasWithout.length);
		});

		it("user table has GSI for phoneNumber (unique)", () => {
			const schemas = generateTableSchemas({ plugins: [phoneNumber()] });
			const userSchema = schemas.find((s) => s.tableName === "user");

			expect(userSchema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "phoneNumber" }),
			);
		});

		it("user table does not have GSI for phoneNumberVerified (not indexed)", () => {
			const schemas = generateTableSchemas({ plugins: [phoneNumber()] });
			const userSchema = schemas.find((s) => s.tableName === "user");

			expect(userSchema?.indexMappings).not.toContainEqual(
				expect.objectContaining({ partitionKey: "phoneNumberVerified" }),
			);
		});
	});

	describe("adapter integration", () => {
		it("user signup works with phoneNumber plugin enabled", async () => {
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
