/**
 * @file DynamoDB transaction helpers.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { DynamoDBAdapterError } from "../errors/errors";

export type DynamoDBTransactionOperation =
	| {
			kind: "put";
			tableName: string;
			item: Record<string, NativeAttributeValue>;
	  }
	| {
			kind: "update";
			tableName: string;
			key: Record<string, NativeAttributeValue>;
			updateExpression: string;
			expressionAttributeNames: Record<string, string>;
			expressionAttributeValues: Record<string, NativeAttributeValue>;
	  }
	| {
			kind: "delete";
			tableName: string;
			key: Record<string, NativeAttributeValue>;
	  };

export type DynamoDBTransactionState = {
	operations: DynamoDBTransactionOperation[];
};

export const createTransactionState = (): DynamoDBTransactionState => ({
	operations: [],
});

export const addTransactionOperation = (
	state: DynamoDBTransactionState,
	operation: DynamoDBTransactionOperation,
): void => {
	if (state.operations.length >= 25) {
		throw new DynamoDBAdapterError(
			"TRANSACTION_LIMIT",
			"DynamoDB transactions are limited to 25 operations.",
		);
	}
	state.operations.push(operation);
};

const buildTransactItem = (
	operation: DynamoDBTransactionOperation,
): Record<string, unknown> => {
	if (operation.kind === "put") {
		return {
			Put: {
				TableName: operation.tableName,
				Item: operation.item,
			},
		};
	}
	if (operation.kind === "update") {
		return {
			Update: {
				TableName: operation.tableName,
				Key: operation.key,
				UpdateExpression: operation.updateExpression,
				ExpressionAttributeNames: operation.expressionAttributeNames,
				ExpressionAttributeValues: operation.expressionAttributeValues,
			},
		};
	}
	return {
		Delete: {
			TableName: operation.tableName,
			Key: operation.key,
		},
	};
};

export const executeTransaction = async (props: {
	documentClient: DynamoDBDocumentClient;
	state: DynamoDBTransactionState;
}): Promise<void> => {
	const { documentClient, state } = props;
	if (state.operations.length === 0) {
		return;
	}

	const transactItems = state.operations.map((operation) =>
		buildTransactItem(operation),
	);

	await documentClient.send(
		new TransactWriteCommand({
			TransactItems: transactItems,
		}),
	);
};
