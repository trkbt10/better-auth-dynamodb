/**
 * @file Official Better Auth adapter test suite for DynamoDB adapter (multi-table).
 */
import { createIndexResolversFromSchemas, dynamodbAdapter, coreTableSchemas } from "../src/index";
import { applyTableSchemas } from "../src/apply-table-schemas";
import { testAdapter } from "./better-auth-adapter-test";
import {
	buildTestConfig,
	createTestClients,
	deleteTables,
	tableNamesFromSchemas,
} from "./adapter-test-helpers";

const testConfig = buildTestConfig({
	endpoint: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
	accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "fakeAccessKeyId",
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "fakeSecretAccessKey",
});

const { client, documentClient } = createTestClients(testConfig);
const tableNamePrefix = "better_auth_test_";
const tables = coreTableSchemas.map((schema) => ({
	...schema,
	tableName: `${tableNamePrefix}${schema.tableName}`,
}));
const tableNames = tableNamesFromSchemas(tables);
const { indexNameResolver, indexKeySchemaResolver } =
	createIndexResolversFromSchemas(coreTableSchemas);

const adapterFactory = dynamodbAdapter({
	documentClient,
	tableNamePrefix,
	transaction: true,
	scanMaxPages: 25,
	indexNameResolver,
	indexKeySchemaResolver,
	debugLogs: {
		isRunningAdapterTests: true,
	},
});

describe("DynamoDB Adapter - Official Adapter Tests (multi-table)", () => {
	beforeAll(async () => {
		await applyTableSchemas({
			client,
			tables,
		});
	});

	afterAll(async () => {
		await deleteTables({ client, tableNames });
	});

	testAdapter({
		getAdapter: async (betterAuthOptions = {}) =>
			adapterFactory(betterAuthOptions),
	});
});
