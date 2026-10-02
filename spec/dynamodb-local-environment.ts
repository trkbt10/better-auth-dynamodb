/**
 * @file Shared setup for specs that run the adapter against DynamoDB Local.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { BetterAuthOptions } from "@better-auth/core";
import type { DBAdapter } from "@better-auth/core/db/adapter";
import { applyTableSchemas } from "../src/apply-table-schemas";
import { dynamodbAdapter } from "../src/adapter";
import {
	createIndexResolversFromSchemas,
	generateTableSchemas,
} from "../src/table-schemas";
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

export const localClients = createTestClients(testConfig);

/**
 * Tables for the given Better Auth options under a prefix of their own, and
 * adapters bound to them.
 */
export const createLocalEnvironment = (props: {
	tableNamePrefix: string;
	options: BetterAuthOptions;
}) => {
	const schemas = generateTableSchemas(props.options);
	const tables = schemas.map((schema) => ({
		...schema,
		tableName: `${props.tableNamePrefix}${schema.tableName}`,
	}));
	const resolvers = createIndexResolversFromSchemas(schemas);
	const createAdapter = (
		config: {
			transaction?: boolean | undefined;
			documentClient?: DynamoDBDocumentClient | undefined;
		} = {},
	): DBAdapter<BetterAuthOptions> =>
		dynamodbAdapter({
			documentClient: config.documentClient ?? localClients.documentClient,
			tableNamePrefix: props.tableNamePrefix,
			scanMaxPages: 25,
			indexNameResolver: resolvers.indexNameResolver,
			indexKeySchemaResolver: resolvers.indexKeySchemaResolver,
			transaction: config.transaction ?? false,
		})(props.options);
	return {
		createAdapter,
		tableName: (model: string): string => `${props.tableNamePrefix}${model}`,
		setUp: () => applyTableSchemas({ client: localClients.client, tables }),
		tearDown: () =>
			deleteTables({
				client: localClients.client,
				tableNames: tableNamesFromSchemas(tables),
			}),
	};
};

/**
 * A document client that runs `interfere` right before the first command
 * accepted by `shouldInterfere` is sent. It reproduces a concurrent writer
 * that gets in between the adapter's read and its write.
 */
export const createInterleavingClient = <TCommand>(props: {
	shouldInterfere: (command: unknown) => command is TCommand;
	interfere: (command: TCommand) => Promise<void>;
}): { documentClient: DynamoDBDocumentClient; interferences: () => number } => {
	const { documentClient } = createTestClients(testConfig);
	const state = { interferences: 0 };
	const send = documentClient.send.bind(documentClient);
	const sendHandler: DynamoDBDocumentClient["send"] = async (
		command: Parameters<typeof send>[0],
	) => {
		if (state.interferences === 0 && props.shouldInterfere(command)) {
			state.interferences += 1;
			await props.interfere(command);
		}
		return send(command);
	};
	documentClient.send = sendHandler;
	return { documentClient, interferences: () => state.interferences };
};

export const captureAsyncError = async (
	fn: () => Promise<unknown>,
): Promise<unknown> => {
	try {
		await fn();
	} catch (error) {
		return error;
	}
	return undefined;
};
