/**
 * @file DynamoDB transaction helpers.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { DynamoDBAdapterError } from "../errors/errors";

/**
 * Condition a buffered write must satisfy when the transaction commits.
 * A failed condition cancels the whole TransactWriteItems request.
 */
export type DynamoDBTransactionCondition = {
	conditionExpression: string;
	expressionAttributeNames: Record<string, string>;
	expressionAttributeValues: Record<string, NativeAttributeValue>;
};

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
			condition?: DynamoDBTransactionCondition | undefined;
	  }
	| {
			kind: "delete";
			tableName: string;
			key: Record<string, NativeAttributeValue>;
			condition?: DynamoDBTransactionCondition | undefined;
	  };

export type DynamoDBTransactionState = {
	operations: DynamoDBTransactionOperation[];
};

export const createTransactionState = (): DynamoDBTransactionState => ({
	operations: [],
});

const isSameKey = (
	left: Record<string, NativeAttributeValue>,
	right: Record<string, NativeAttributeValue>,
): boolean => {
	const leftEntries = Object.entries(left);
	if (leftEntries.length !== Object.keys(right).length) {
		return false;
	}
	return leftEntries.every(([name, value]) => Object.is(right[name], value));
};

/**
 * Whether the transaction already deletes the item with the given key.
 */
export const hasBufferedDelete = (
	state: DynamoDBTransactionState,
	target: { tableName: string; key: Record<string, NativeAttributeValue> },
): boolean =>
	state.operations.some((operation) => {
		if (operation.kind !== "delete") {
			return false;
		}
		if (operation.tableName !== target.tableName) {
			return false;
		}
		return isSameKey(operation.key, target.key);
	});

export const addTransactionOperation = (
	state: DynamoDBTransactionState,
	operation: DynamoDBTransactionOperation,
): void => {
	// TransactWriteItems rejects two operations on one item. A row deleted
	// earlier in the transaction is already gone for the rest of it, so a
	// repeated delete is dropped; the first one keeps its condition.
	if (operation.kind === "delete" && hasBufferedDelete(state, operation)) {
		return;
	}
	if (state.operations.length >= 25) {
		throw new DynamoDBAdapterError(
			"TRANSACTION_LIMIT",
			"DynamoDB transactions are limited to 25 operations.",
		);
	}
	state.operations.push(operation);
};

const buildConditionInput = (
	condition: DynamoDBTransactionCondition | undefined,
): Record<string, unknown> => {
	if (!condition) {
		return {};
	}
	return { ConditionExpression: condition.conditionExpression };
};

// DynamoDB rejects an empty ExpressionAttributeNames / ExpressionAttributeValues map.
const buildAttributeInput = (props: {
	expressionAttributeNames: Record<string, string>;
	expressionAttributeValues: Record<string, NativeAttributeValue>;
}): Record<string, unknown> => {
	const input: Record<string, unknown> = {};
	if (Object.keys(props.expressionAttributeNames).length > 0) {
		input.ExpressionAttributeNames = props.expressionAttributeNames;
	}
	if (Object.keys(props.expressionAttributeValues).length > 0) {
		input.ExpressionAttributeValues = props.expressionAttributeValues;
	}
	return input;
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
				...buildConditionInput(operation.condition),
				...buildAttributeInput({
					expressionAttributeNames: {
						...operation.expressionAttributeNames,
						...operation.condition?.expressionAttributeNames,
					},
					expressionAttributeValues: {
						...operation.expressionAttributeValues,
						...operation.condition?.expressionAttributeValues,
					},
				}),
			},
		};
	}
	return {
		Delete: {
			TableName: operation.tableName,
			Key: operation.key,
			...buildConditionInput(operation.condition),
			...buildAttributeInput({
				expressionAttributeNames:
					operation.condition?.expressionAttributeNames ?? {},
				expressionAttributeValues:
					operation.condition?.expressionAttributeValues ?? {},
			}),
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
