/**
 * @file Official Better Auth adapter test suite for DynamoDB adapter.
 */
import {
	CreateTableCommand,
	DeleteTableCommand,
	DynamoDBClient,
	ListTablesCommand,
	waitUntilTableExists,
	waitUntilTableNotExists,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { dynamodbAdapter } from "../src/index";
import { paginate } from "../src/dynamodb/ops/paginate";
import { testAdapter } from "./better-auth-adapter-test";

type DynamoDBTestConfig = {
	endpoint: string;
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
	tableNamePrefix: string;
	idAttributeType: "S" | "N";
};

const buildTestConfig = (
	overrides: Partial<DynamoDBTestConfig> = {},
): DynamoDBTestConfig => {
	const config: DynamoDBTestConfig = {
		endpoint: overrides.endpoint ?? "http://localhost:8000",
		region: overrides.region ?? "us-east-1",
		accessKeyId: overrides.accessKeyId ?? "fakeAccessKeyId",
		secretAccessKey: overrides.secretAccessKey ?? "fakeSecretAccessKey",
		tableNamePrefix: overrides.tableNamePrefix ?? "better_auth_test_",
		idAttributeType: overrides.idAttributeType ?? "S",
	};

	const values = [
		config.endpoint,
		config.region,
		config.accessKeyId,
		config.secretAccessKey,
		config.tableNamePrefix,
	];

	if (values.some((value) => value.length === 0)) {
		throw new Error("DynamoDB test configuration is incomplete.");
	}

	return config;
};

const createTestClients = (config: DynamoDBTestConfig) => {
	const client = new DynamoDBClient({
		endpoint: config.endpoint,
		region: config.region,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
		},
	});

	const documentClient = DynamoDBDocumentClient.from(client, {
		marshallOptions: {
			removeUndefinedValues: true,
		},
	});

	return { client, documentClient };
};

const listTableNames = async (client: DynamoDBClient): Promise<string[]> => {
	const tableNames: string[] = [];

	await paginate<string>({
		fetchPage: async (lastEvaluatedTableName) => {
			const response = await client.send(
				new ListTablesCommand({
					ExclusiveStartTableName: lastEvaluatedTableName,
				}),
			);
			tableNames.push(...(response.TableNames ?? []));
			const nextToken = response.LastEvaluatedTableName ?? undefined;
			return { nextToken };
		},
	});

	return tableNames;
};

const ensureTables = async (props: {
	client: DynamoDBClient;
	config: DynamoDBTestConfig;
	models: string[];
}): Promise<string[]> => {
	const { client, config, models } = props;
	const tableNames = models.map((model) => `${config.tableNamePrefix}${model}`);
	const existingTables = await listTableNames(client);

	const missingTables = tableNames.filter(
		(tableName) => !existingTables.includes(tableName),
	);

	for (const tableName of missingTables) {
		await client.send(
			new CreateTableCommand({
				TableName: tableName,
				BillingMode: "PAY_PER_REQUEST",
				AttributeDefinitions: [
					{ AttributeName: "id", AttributeType: config.idAttributeType },
				],
				KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
			}),
		);
		await waitUntilTableExists(
			{ client, maxWaitTime: 60, minDelay: 2 },
			{ TableName: tableName },
		);
	}

	return tableNames;
};

const deleteTables = async (props: {
	client: DynamoDBClient;
	tableNames: string[];
}): Promise<void> => {
	const { client, tableNames } = props;

	for (const tableName of tableNames) {
		try {
			await client.send(new DeleteTableCommand({ TableName: tableName }));
			await waitUntilTableNotExists(
				{ client, maxWaitTime: 60, minDelay: 2 },
				{ TableName: tableName },
			);
		} catch (error) {
			if (error instanceof Error) {
				if (error.name === "ResourceNotFoundException") {
					continue;
				}
			}
			throw error;
		}
	}
};

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
	scanMaxPages: 25,
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

	testAdapter({
		getAdapter: async (betterAuthOptions = {}) =>
			adapterFactory(betterAuthOptions),
	});
});
