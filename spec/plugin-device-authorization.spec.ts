/**
 * @file Integration tests for the Device Authorization plugin with DynamoDB adapter.
 *
 * Device Authorization plugin adds:
 * - deviceCode table with userId field
 *
 * Note: Better Auth's schema does not include index/references for userId,
 * but the documentation states "userId references the user table".
 * We apply schema extensions to add proper GSI for userId.
 *
 * @see https://www.better-auth.com/docs/plugins/device-authorization
 */
import { betterAuth } from "better-auth";
import { deviceAuthorization } from "better-auth/plugins";
import { dynamodbAdapter } from "../src/adapter";
import {
	generateTableSchemas,
	createIndexResolversFromSchemas,
} from "../src/table-schemas";
import { createStatefulDocumentClient } from "./stateful-document-client";

const plugins = [deviceAuthorization()];
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

describe("deviceAuthorization plugin", () => {
	describe("schema generation", () => {
		it("creates deviceCode table", () => {
			const schemas = generateTableSchemas({
				plugins: [deviceAuthorization()],
			});
			const tableNames = schemas.map((s) => s.tableName);

			expect(tableNames).toContain("deviceCode");
		});

		it("deviceCode table has id as primary key", () => {
			const schemas = generateTableSchemas({
				plugins: [deviceAuthorization()],
			});
			const deviceCodeSchema = schemas.find((s) => s.tableName === "deviceCode");

			expect(deviceCodeSchema).toBeDefined();
			expect(deviceCodeSchema?.tableDefinition.keySchema).toEqual([
				{ AttributeName: "id", KeyType: "HASH" },
			]);
		});

		it("deviceCode table has GSI for userId (via schema extension)", () => {
			const schemas = generateTableSchemas({
				plugins: [deviceAuthorization()],
			});
			const deviceCodeSchema = schemas.find((s) => s.tableName === "deviceCode");

			// userId GSI is added via schema extension
			expect(deviceCodeSchema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "userId" }),
			);
		});

		it("deviceCode table has no GSI for userId when schema extensions disabled", () => {
			const schemas = generateTableSchemas(
				{ plugins: [deviceAuthorization()] },
				{ disableSchemaExtensions: true },
			);
			const deviceCodeSchema = schemas.find((s) => s.tableName === "deviceCode");

			// Without extension, userId has no GSI (Better Auth schema lacks index/references)
			expect(deviceCodeSchema?.indexMappings).not.toContainEqual(
				expect.objectContaining({ partitionKey: "userId" }),
			);
		});
	});
});

describe("deviceAuthorization plugin (adapter integration)", () => {
	it("creates device code request", async () => {
		const { documentClient } = createStatefulDocumentClient();
		const auth = createAuth(documentClient, true);

		const result = await auth.api.deviceCode({
			body: { client_id: "test-client" },
		});

		expect(result).toBeDefined();
		expect(result.device_code).toBeDefined();
		expect(result.user_code).toBeDefined();
		expect(result.verification_uri).toBeDefined();
	});

	it("stores device code in database", async () => {
		const { documentClient, store } = createStatefulDocumentClient();
		const auth = createAuth(documentClient, false);

		await auth.api.deviceCode({
			body: { client_id: "test-client" },
		});

		const deviceCodes = store.get("auth_deviceCode");
		expect(deviceCodes.length).toBeGreaterThan(0);
		expect(deviceCodes[0]).toHaveProperty("deviceCode");
		expect(deviceCodes[0]).toHaveProperty("userCode");
		expect(deviceCodes[0]).toHaveProperty("status", "pending");
	});
});
