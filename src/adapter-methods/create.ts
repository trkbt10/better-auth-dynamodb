/**
 * @file Create method for the DynamoDB adapter.
 */
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import type { AdapterClientContainer } from "./client-container";
import { resolveTableName } from "../dynamodb/mapping/resolve-table-name";
import {
	addTransactionOperation,
	type DynamoDBTransactionState,
} from "../dynamodb/ops/transaction";

export type CreateMethodOptions = {
	adapterConfig: ResolvedDynamoDBAdapterConfig;
	getDefaultModelName: (model: string) => string;
	transactionState?: DynamoDBTransactionState | undefined;
};

export const createCreateMethod = (
	client: AdapterClientContainer,
	options: CreateMethodOptions,
) => {
	const { documentClient } = client;
	const { adapterConfig, getDefaultModelName, transactionState } = options;
	const resolveModelTableName = (model: string) =>
		resolveTableName({
			model,
			getDefaultModelName,
			config: adapterConfig,
		});

	return async <T extends Record<string, unknown>>({
		model,
		data,
	}: {
		model: string;
		data: T;
	}) => {
		const tableName = resolveModelTableName(model);
		if (transactionState) {
			addTransactionOperation(transactionState, {
				kind: "put",
				tableName,
				item: data as Record<string, NativeAttributeValue>,
			});
			return data;
		}
		await documentClient.send(
			new PutCommand({
				TableName: tableName,
				Item: data,
			}),
		);
		return data;
	};
};
