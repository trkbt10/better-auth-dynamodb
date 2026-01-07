/**
 * @file Official Better Auth adapter test suite for DynamoDB adapter.
 */
import { runAdapterTest } from "better-auth/adapters/test";
import { dynamodbAdapter } from "../src/index";
import {
	buildTestConfig,
	createTestClients,
	deleteTables,
	ensureTables,
} from "./dynamodb-test-utils";

const testConfig = buildTestConfig({
	endpoint: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
	accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "fakeAccessKeyId",
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "fakeSecretAccessKey",
	tableNamePrefix: "better_auth_test_",
	idAttributeType: "S",
});

const { client, documentClient } = createTestClients(testConfig);
const models = ["user", "session", "account", "verification"];

const adapterFactory = dynamodbAdapter({
	documentClient,
	tableNamePrefix: testConfig.tableNamePrefix,
	transaction: true,
	debugLogs: {
		isRunningAdapterTests: true,
	},
});

describe("DynamoDB Adapter - Official Adapter Tests", () => {
	const state = { createdTables: [] as string[] };

	beforeAll(async () => {
		state.createdTables = await ensureTables({
			client,
			config: testConfig,
			models,
		});
	});

	afterAll(async () => {
		await deleteTables({ client, tableNames: state.createdTables });
	});

	runAdapterTest({
		getAdapter: async (betterAuthOptions = {}) =>
			adapterFactory(betterAuthOptions),
	});
});
