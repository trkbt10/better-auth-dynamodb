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
	if (props.model === "session" && props.field === "token") {
		return "session_token_idx";
	}
	if (props.model === "session" && props.field === "userId") {
		return "session_userId_idx";
	}
	if (props.model === "account" && props.field === "userId") {
		return "account_userId_idx";
	}
	if (props.model === "account" && props.field === "providerId") {
		return "account_providerId_accountId_idx";
	}
	if (props.model === "verification" && props.field === "identifier") {
		return "verification_identifier_idx";
	}
	return undefined;
};

const indexKeySchemaResolver = (props: { model: string; indexName: string }) => {
	if (props.model === "session" && props.indexName === "session_userId_idx") {
		return { partitionKey: "userId", sortKey: "createdAt" };
	}
	if (props.model === "session" && props.indexName === "session_token_idx") {
		return { partitionKey: "token", sortKey: "createdAt" };
	}
	if (props.model === "account" && props.indexName === "account_userId_idx") {
		return { partitionKey: "userId" };
	}
	if (
		props.model === "account" &&
		props.indexName === "account_providerId_accountId_idx"
	) {
		return { partitionKey: "providerId", sortKey: "accountId" };
	}
	if (
		props.model === "verification" &&
		props.indexName === "verification_identifier_idx"
	) {
		return { partitionKey: "identifier", sortKey: "createdAt" };
	}
	return undefined;
};

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
