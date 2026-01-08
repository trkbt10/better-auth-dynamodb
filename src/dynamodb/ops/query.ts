/**
 * @file DynamoDB query helpers for adapter.
 */
import type {
	DynamoDBDocumentClient,
	QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { applyExpressionAttributes } from "./apply-expression-attributes";
import { paginate } from "./paginate";
import { resolveRemainingLimit } from "./resolve-remaining-limit";

export type DynamoDBQueryOptions = {
	documentClient: DynamoDBDocumentClient;
	tableName: string;
	indexName?: string | undefined;
	keyConditionExpression: string;
	filterExpression: string | undefined;
	expressionAttributeNames: Record<string, string>;
	expressionAttributeValues: Record<string, NativeAttributeValue>;
	limit?: number | undefined;
};

export const queryItems = async (
	options: DynamoDBQueryOptions,
): Promise<Record<string, NativeAttributeValue>[]> => {
	const items: Record<string, NativeAttributeValue>[] = [];
	await paginate<Record<string, NativeAttributeValue>>({
		fetchPage: async (lastEvaluatedKey) => {
			const remaining = resolveRemainingLimit(options.limit, items.length);

			if (remaining === 0) {
				return { shouldStop: true };
			}

			const commandInput: QueryCommandInput = {
				TableName: options.tableName,
				KeyConditionExpression: options.keyConditionExpression,
			};

			if (options.indexName) {
				commandInput.IndexName = options.indexName;
			}

			applyExpressionAttributes(commandInput, {
				filterExpression: options.filterExpression,
				expressionAttributeNames: options.expressionAttributeNames,
				expressionAttributeValues: options.expressionAttributeValues,
			});

			if (lastEvaluatedKey) {
				commandInput.ExclusiveStartKey = lastEvaluatedKey;
			}

			if (remaining !== undefined) {
				commandInput.Limit = remaining;
			}

			const result = await options.documentClient.send(
				new QueryCommand(commandInput),
			);
			const pageItems = (result.Items ?? []) as Record<string, unknown>[];
			items.push(...pageItems);

			const nextToken =
				(result.LastEvaluatedKey as
					| Record<string, NativeAttributeValue>
					| undefined) ??
				undefined;

			return { nextToken };
		},
	});

	return items;
};

export const queryCount = async (
	options: Omit<DynamoDBQueryOptions, "limit">,
): Promise<number> => {
	const state = { count: 0 };

	await paginate<Record<string, NativeAttributeValue>>({
		fetchPage: async (lastEvaluatedKey) => {
			const commandInput: QueryCommandInput = {
				TableName: options.tableName,
				KeyConditionExpression: options.keyConditionExpression,
				Select: "COUNT",
			};

			if (options.indexName) {
				commandInput.IndexName = options.indexName;
			}

			applyExpressionAttributes(commandInput, {
				filterExpression: options.filterExpression,
				expressionAttributeNames: options.expressionAttributeNames,
				expressionAttributeValues: options.expressionAttributeValues,
			});

			if (lastEvaluatedKey) {
				commandInput.ExclusiveStartKey = lastEvaluatedKey;
			}

			const result = await options.documentClient.send(
				new QueryCommand(commandInput),
			);
			state.count += result.Count ?? 0;
			const nextToken =
				(result.LastEvaluatedKey as
					| Record<string, NativeAttributeValue>
					| undefined) ??
				undefined;

			return { nextToken };
		},
	});

	return state.count;
};
