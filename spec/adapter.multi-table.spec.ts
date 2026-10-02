/**
 * @file Official Better Auth adapter conformance suites (@better-auth/test-utils) for the DynamoDB adapter (multi-table).
 *
 * The suites add models and fields per test and call `runMigrations(betterAuthOptions)`
 * before the tests that need them. Tables are derived from those options with this
 * repository's `generateTableSchemas` and applied to DynamoDB Local with
 * `applyTableSchemas`; the adapter's index resolvers are derived from the same options.
 */
import type { BetterAuthOptions } from "@better-auth/core";
import {
	authFlowTestSuite,
	caseInsensitiveTestSuite,
	joinsTestSuite,
	normalTestSuite,
	testAdapter,
	transactionsTestSuite,
	uuidTestSuite,
} from "@better-auth/test-utils/adapter";
import { createIndexResolversFromSchemas, dynamodbAdapter, generateTableSchemas } from "../src/index";
import { applyTableSchemas } from "../src/apply-table-schemas";
import type { TableSchema } from "../src/dynamodb/types";
import { buildTestConfig, createTestClients, deleteTables } from "./adapter-test-helpers";

const testConfig = buildTestConfig({
	endpoint: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
	accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "fakeAccessKeyId",
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "fakeSecretAccessKey",
});

const { client, documentClient } = createTestClients(testConfig);
const tableNamePrefix = "better_auth_test_";
const appliedTableNames = new Set<string>();

const prefixedTableSchemas = (options: BetterAuthOptions): TableSchema[] =>
	generateTableSchemas(options).map((schema) => ({
		...schema,
		tableName: `${tableNamePrefix}${schema.tableName}`,
	}));

const runMigrations = async (options: BetterAuthOptions): Promise<void> => {
	const tables = prefixedTableSchemas(options);
	await applyTableSchemas({ client, tables });
	for (const table of tables) {
		appliedTableNames.add(table.tableName);
	}
};

const createAdapter = (options: BetterAuthOptions) => {
	const { indexNameResolver, indexKeySchemaResolver } = createIndexResolversFromSchemas(
		generateTableSchemas(options),
	);
	return dynamodbAdapter({
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
};

const { execute } = await testAdapter({
	adapter: createAdapter,
	runMigrations,
	prefixTests: "multi-table",
	tests: [
		normalTestSuite(),
		transactionsTestSuite(),
		authFlowTestSuite(),
		joinsTestSuite(),
		caseInsensitiveTestSuite(),
		// Ids stay strings: the adapter declares neither native UUID nor numeric
		// id support, so the number-id suite does not apply.
		uuidTestSuite(),
	],
	onFinish: async () => {
		await deleteTables({ client, tableNames: [...appliedTableNames] });
	},
});

execute();
