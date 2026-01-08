/**
 * @file Shared helpers for adapter integration specs.
 */
import {
	DeleteTableCommand,
	DynamoDBClient,
	waitUntilTableNotExists,
	type WaiterConfiguration,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { TableSchema } from "../src/table-schema";

export type DynamoDBTestConfig = {
	endpoint: string;
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
};

export const buildTestConfig = (
	overrides: Partial<DynamoDBTestConfig> = {},
): DynamoDBTestConfig => {
	const config: DynamoDBTestConfig = {
		endpoint: overrides.endpoint ?? "http://localhost:8000",
		region: overrides.region ?? "us-east-1",
		accessKeyId: overrides.accessKeyId ?? "fakeAccessKeyId",
		secretAccessKey: overrides.secretAccessKey ?? "fakeSecretAccessKey",
	};

	const values = [
		config.endpoint,
		config.region,
		config.accessKeyId,
		config.secretAccessKey,
	];

	if (values.some((value) => value.length === 0)) {
		throw new Error("DynamoDB test configuration is incomplete.");
	}

	return config;
};

export const createTestClients = (config: DynamoDBTestConfig) => {
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

export const tableNamesFromSchemas = (schemas: TableSchema[]): string[] => {
	return schemas.map((schema) => schema.tableName);
};

export const deleteTables = async (props: {
	client: DynamoDBClient;
	tableNames: string[];
	wait?: WaiterConfiguration<DynamoDBClient> | undefined;
}): Promise<void> => {
	const waitConfig = props.wait ?? { maxWaitTime: 60, minDelay: 2 };

	for (const tableName of props.tableNames) {
		try {
			await props.client.send(new DeleteTableCommand({ TableName: tableName }));
			await waitUntilTableNotExists(
				{ client: props.client, ...waitConfig },
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
