/**
 * @file DynamoDB query helpers for adapter.
 */
import type { DynamoDBDocumentClient, QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

export type DynamoDBQueryOptions = {
	documentClient: DynamoDBDocumentClient;
	tableName: string;
	keyConditionExpression: string;
	filterExpression: string | undefined;
	expressionAttributeNames: Record<string, string>;
	expressionAttributeValues: Record<string, NativeAttributeValue>;
	limit?: number | undefined;
};

const resolveRemainingLimit = (
	limit: number | undefined,
	currentCount: number,
): number | undefined => {
	if (limit === undefined) {
		return undefined;
	}
	const remaining = limit - currentCount;
	if (remaining <= 0) {
		return 0;
	}
	return remaining;
};

export const queryItems = async (
	options: DynamoDBQueryOptions,
): Promise<Record<string, NativeAttributeValue>[]> => {
	const items: Record<string, NativeAttributeValue>[] = [];
	const state = {
		lastEvaluatedKey: undefined as Record<string, NativeAttributeValue> | undefined,
	};

	for (;;) {
		const remaining = resolveRemainingLimit(options.limit, items.length);

		if (remaining === 0) {
			break;
		}

		const commandInput: QueryCommandInput = {
			TableName: options.tableName,
			KeyConditionExpression: options.keyConditionExpression,
		};

		if (options.filterExpression) {
			commandInput.FilterExpression = options.filterExpression;
		}

		if (Object.keys(options.expressionAttributeNames).length > 0) {
			commandInput.ExpressionAttributeNames =
				options.expressionAttributeNames;
		}

		if (Object.keys(options.expressionAttributeValues).length > 0) {
			commandInput.ExpressionAttributeValues =
				options.expressionAttributeValues;
		}

		if (state.lastEvaluatedKey) {
			commandInput.ExclusiveStartKey = state.lastEvaluatedKey;
		}

		if (remaining !== undefined) {
			commandInput.Limit = remaining;
		}

		const result = await options.documentClient.send(
			new QueryCommand(commandInput),
		);
		const pageItems = (result.Items ?? []) as Record<string, unknown>[];
		items.push(...pageItems);

		state.lastEvaluatedKey =
			(result.LastEvaluatedKey as Record<string, NativeAttributeValue> | undefined) ??
			undefined;

		if (!state.lastEvaluatedKey) {
			break;
		}
	}

	return items;
};

export const queryCount = async (
	options: Omit<DynamoDBQueryOptions, "limit">,
): Promise<number> => {
	const state = {
		lastEvaluatedKey: undefined as Record<string, NativeAttributeValue> | undefined,
		count: 0,
	};

	for (;;) {
		const commandInput: QueryCommandInput = {
			TableName: options.tableName,
			KeyConditionExpression: options.keyConditionExpression,
			Select: "COUNT",
		};

		if (options.filterExpression) {
			commandInput.FilterExpression = options.filterExpression;
		}

		if (Object.keys(options.expressionAttributeNames).length > 0) {
			commandInput.ExpressionAttributeNames =
				options.expressionAttributeNames;
		}

		if (Object.keys(options.expressionAttributeValues).length > 0) {
			commandInput.ExpressionAttributeValues =
				options.expressionAttributeValues;
		}

		if (state.lastEvaluatedKey) {
			commandInput.ExclusiveStartKey = state.lastEvaluatedKey;
		}

		const result = await options.documentClient.send(
			new QueryCommand(commandInput),
		);
		state.count += result.Count ?? 0;
		state.lastEvaluatedKey =
			(result.LastEvaluatedKey as Record<string, NativeAttributeValue> | undefined) ??
			undefined;

		if (!state.lastEvaluatedKey) {
			break;
		}
	}

	return state.count;
};
