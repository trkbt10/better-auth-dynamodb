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

/**
 * Tests of the basic CRUD suite that fail on adapter behavior; shared by the
 * normal suite and the joins suite, which reuses the same test bodies.
 */
const basicSuiteDisabledTests = {
	// ValidationException: Invalid attribute value type (null written to the GSI key attribute nullableReference)
	"create - should return null for nullable foreign keys": true,
	// ValidationException: The table does not have the specified index: user_custom_email_idx
	"findOne - should find a model with modified model name": true,
	// ValidationException: The table does not have the specified index: one_to_one_table_one_to_one_idx
	"findOne - should join a model with modified field name": true,
	// expect(received).toSatisfy(): findMany returns every attribute although select is ["id", "email"]
	"findMany - should select fields": true,
	// DynamoDBAdapterError: Update payload must include at least one defined value. (updateMany to an unchanged value)
	"deleteMany - should delete many models with boolean values": true,
};

const { execute } = await testAdapter({
	adapter: createAdapter,
	runMigrations,
	prefixTests: "multi-table",
	tests: [
		normalTestSuite({ disableTests: basicSuiteDisabledTests }),
		transactionsTestSuite({
			disableTests: {
				// expected [] to have a length of 1 but got +0: tx.findMany does not see the row created earlier in the same transaction
				"transaction - should rollback failing transaction": true,
			},
		}),
		authFlowTestSuite(),
		joinsTestSuite({ disableTests: basicSuiteDisabledTests }),
		caseInsensitiveTestSuite({
			disableTests: {
				// expected null not to be null: mode "insensitive" is ignored
				"findOne - eq with mode insensitive should match regardless of case": true,
				// expected [] to have a length of 1 but got +0: mode "insensitive" is ignored
				"findMany - eq with mode insensitive": true,
				// expected [ …(4) ] to not include '<id>': mode "insensitive" is ignored
				"findMany - ne with mode insensitive": true,
				// expected [] to have a length of 1 but got +0: mode "insensitive" is ignored
				"findMany - in with mode insensitive": true,
				// expected [ …(3) ] to not include '<id>': mode "insensitive" is ignored
				"findMany - not_in with mode insensitive": true,
				// expected 0 to be greater than or equal to 1: mode "insensitive" is ignored
				"findMany - contains with mode insensitive": true,
				// expected 0 to be greater than or equal to 1: mode "insensitive" is ignored
				"findMany - starts_with with mode insensitive": true,
				// expected 0 to be greater than or equal to 1: mode "insensitive" is ignored
				"findMany - ends_with with mode insensitive": true,
				// expected 0 to be greater than or equal to 1: mode "insensitive" is ignored
				"count - with mode insensitive": true,
				// expected null not to be null: mode "insensitive" is ignored
				"update - where with mode insensitive": true,
				// expected { name: 'ToDelete', …(6) } to be null: mode "insensitive" is ignored
				"deleteMany - where with mode insensitive": true,
			},
		}),
	],
	onFinish: async () => {
		await deleteTables({ client, tableNames: [...appliedTableNames] });
	},
});

execute();
