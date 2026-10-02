/**
 * @file Create method for the DynamoDB adapter.
 */
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import type { AdapterClientContainer } from "./client-container";
import { DynamoDBAdapterError } from "../dynamodb/errors/errors";
import { resolveTableName } from "../dynamodb/mapping/resolve-table-name";
import { isConditionalCheckFailure } from "../dynamodb/ops/conditional-write";
import {
	bufferTransactionCreate,
	type DynamoDBTransactionState,
} from "../dynamodb/ops/transaction";

export type CreateMethodOptions = {
	adapterConfig: ResolvedDynamoDBAdapterConfig;
	getFieldName: (args: { model: string; field: string }) => string;
	getDefaultModelName: (model: string) => string;
	transactionState?: DynamoDBTransactionState | undefined;
};

export const createCreateMethod = (
	client: AdapterClientContainer,
	options: CreateMethodOptions,
) => {
	const { documentClient } = client;
	const { adapterConfig, getFieldName, getDefaultModelName, transactionState } =
		options;
	const resolveModelTableName = (model: string) =>
		resolveTableName({
			model,
			getDefaultModelName,
			config: adapterConfig,
		});

	// PutItem replaces an existing item unless told otherwise. A create must
	// fail on a primary key that is already taken, as an INSERT does: Better
	// Auth relies on that to make a deterministic id a first-writer-wins gate.
	const putNewItem = async (props: {
		tableName: string;
		primaryKeyName: string;
		item: Record<string, NativeAttributeValue>;
	}): Promise<void> => {
		try {
			await documentClient.send(
				new PutCommand({
					TableName: props.tableName,
					Item: props.item,
					ConditionExpression: "attribute_not_exists(#pk)",
					ExpressionAttributeNames: { "#pk": props.primaryKeyName },
				}),
			);
		} catch (error) {
			if (isConditionalCheckFailure(error)) {
				throw new DynamoDBAdapterError(
					"DUPLICATE_PRIMARY_KEY",
					`A row with ${props.primaryKeyName} "${String(props.item[props.primaryKeyName])}" already exists in ${props.tableName}.`,
				);
			}
			throw error;
		}
	};

	return async <T extends Record<string, unknown>>({
		model,
		data,
	}: {
		model: string;
		data: T;
	}) => {
		const tableName = resolveModelTableName(model);
		const primaryKeyName = getFieldName({ model, field: "id" });
		const item = data as Record<string, NativeAttributeValue>;
		if (transactionState) {
			bufferTransactionCreate(transactionState, {
				tableName,
				keyField: primaryKeyName,
				item,
			});
			return data;
		}
		await putNewItem({ tableName, primaryKeyName, item });
		return data;
	};
};
