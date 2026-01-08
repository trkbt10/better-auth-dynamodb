/**
 * @file Official Better Auth adapter test suite for DynamoDB adapter (multi-table).
 */
import { dynamodbAdapter } from "../src/index";
import { createTables } from "../src/create-tables";
import { multiTableSchemas } from "../src/table-schema";
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
const tables = multiTableSchemas.map((schema) => ({
	...schema,
	tableName: `${tableNamePrefix}${schema.tableName}`,
}));
const tableNames = tableNamesFromSchemas(tables);
const indexNameResolver = (props: { model: string; field: string }) => {
	if (props.model === "session" && props.field === "userId") {
		return "session_userId_idx";
	}
	if (props.model === "account" && props.field === "userId") {
		return "account_userId_idx";
	}
	if (props.model === "verification" && props.field === "identifier") {
		return "verification_identifier_idx";
	}
	return undefined;
};

const adapterFactory = dynamodbAdapter({
	documentClient,
	tableNamePrefix,
	transaction: true,
	scanMaxPages: 25,
	indexNameResolver,
	debugLogs: {
		isRunningAdapterTests: true,
	},
});

describe("DynamoDB Adapter - Official Adapter Tests (multi-table)", () => {
	beforeAll(async () => {
		await createTables({
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
