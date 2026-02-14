/**
 * @file Integration tests for the JWT plugin with DynamoDB adapter.
 *
 * JWT plugin adds:
 * - jwks table (no indexes, no references)
 */
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { dynamodbAdapter } from "../src/adapter";
import {
	generateTableSchemas,
	createIndexResolversFromSchemas,
} from "../src/table-schemas";
import { createStatefulDocumentClient } from "./stateful-document-client";
import { signUpAndGetHeaders } from "./plugin-test-utils";

const plugins = [jwt()];
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

describe("jwt plugin", () => {
	describe("schema generation", () => {
		it("creates jwks table", () => {
			const schemas = generateTableSchemas({
				plugins: [jwt()],
			});
			const tableNames = schemas.map((s) => s.tableName);

			expect(tableNames).toContain("jwks");
		});

		it("jwks table has id as primary key", () => {
			const schemas = generateTableSchemas({
				plugins: [jwt()],
			});
			const jwksSchema = schemas.find((s) => s.tableName === "jwks");

			expect(jwksSchema).toBeDefined();
			expect(jwksSchema?.tableDefinition.keySchema).toEqual([
				{ AttributeName: "id", KeyType: "HASH" },
			]);
		});

		it("jwks table has no GSIs", () => {
			const schemas = generateTableSchemas({
				plugins: [jwt()],
			});
			const jwksSchema = schemas.find((s) => s.tableName === "jwks");

			// jwks has no indexed/unique/reference fields
			expect(jwksSchema?.tableDefinition.globalSecondaryIndexes).toBeUndefined();
			expect(jwksSchema?.indexMappings).toHaveLength(0);
		});
	});

	describe("adapter integration", () => {
		it("generates JWT token for authenticated user", async () => {
			const { documentClient } = createStatefulDocumentClient();
			const auth = createAuth(documentClient, true);

			const { headers } = await signUpAndGetHeaders(
				auth,
				"alice@example.com",
				"Alice",
			);

			const result = await auth.api.getToken({
				headers,
			});

			expect(result).toBeDefined();
			expect(result.token).toBeDefined();
			expect(typeof result.token).toBe("string");
		});
	});
});
