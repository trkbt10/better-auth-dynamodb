/**
 * @file DynamoDB adapter configuration types.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { DBAdapterDebugLogOption } from "@better-auth/core/db/adapter";

export type DynamoDBTableNameResolver = (modelName: string) => string;

export type DynamoDBAdapterConfig = {
	documentClient: DynamoDBDocumentClient;
	debugLogs?: DBAdapterDebugLogOption | undefined;
	usePlural?: boolean | undefined;
	tableNamePrefix?: string | undefined;
	tableNameResolver?: DynamoDBTableNameResolver | undefined;
	transaction?: boolean | undefined;
};

export type ResolvedDynamoDBAdapterConfig = {
	documentClient: DynamoDBDocumentClient;
	debugLogs: DBAdapterDebugLogOption | undefined;
	usePlural: boolean;
	tableNamePrefix?: string | undefined;
	tableNameResolver?: DynamoDBTableNameResolver | undefined;
	transaction: boolean;
};

export const resolveAdapterConfig = (
	config: DynamoDBAdapterConfig,
): ResolvedDynamoDBAdapterConfig => {
	return {
		documentClient: config.documentClient,
		debugLogs: config.debugLogs,
		usePlural: config.usePlural ?? false,
		tableNamePrefix: config.tableNamePrefix,
		tableNameResolver: config.tableNameResolver,
		transaction: config.transaction ?? false,
	};
};
