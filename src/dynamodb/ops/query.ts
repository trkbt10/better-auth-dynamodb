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
import type { DynamoDBOperationStatsCollector } from "./operation-stats";

export type DynamoDBQueryOptions = {
	documentClient: DynamoDBDocumentClient;
	tableName: string;
	indexName?: string | undefined;
	keyConditionExpression: string;
	filterExpression: string | undefined;
	expressionAttributeNames: Record<string, string>;
	expressionAttributeValues: Record<string, NativeAttributeValue>;
	limit?: number | undefined;
	scanIndexForward?: boolean | undefined;
	explainDynamoOperations?: boolean | undefined;
	operationStats?: DynamoDBOperationStatsCollector | undefined;
};

export const queryItems = async (
	options: DynamoDBQueryOptions,
): Promise<Record<string, NativeAttributeValue>[]> => {
	const items: Record<string, NativeAttributeValue>[] = [];
	const state = { pages: 0 };
	await paginate<Record<string, NativeAttributeValue>>({
		fetchPage: async (lastEvaluatedKey) => {
			state.pages += 1;
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
			if (options.scanIndexForward !== undefined) {
				commandInput.ScanIndexForward = options.scanIndexForward;
			}

			const result = await options.documentClient.send(
				new QueryCommand(commandInput),
			);
			const pageItems = (result.Items ?? []) as Record<string, unknown>[];
			items.push(...pageItems);
			options.operationStats?.recordQuery({
				tableName: options.tableName,
				items: pageItems.length,
			});

			const nextToken =
				(result.LastEvaluatedKey as
					| Record<string, NativeAttributeValue>
					| undefined) ??
				undefined;

			return { nextToken };
		},
	});

	if (options.explainDynamoOperations) {
		const limit = options.limit === undefined ? "∞" : String(options.limit);
		const hasFilter = options.filterExpression ? "yes" : "no";
		const indexName = options.indexName ?? "(primary)";
		console.log(
			`DDB-OP QUERY table=${options.tableName} index=${indexName} pages=${state.pages} items=${items.length} limit=${limit} filter=${hasFilter}`,
		);
	}

	return items;
};

export const queryCount = async (
	options: Omit<DynamoDBQueryOptions, "limit">,
): Promise<number> => {
	const state = { count: 0 };
	const pageState = { pages: 0 };

	await paginate<Record<string, NativeAttributeValue>>({
		fetchPage: async (lastEvaluatedKey) => {
			pageState.pages += 1;
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
			const pageCount = result.Count ?? 0;
			state.count += pageCount;
			options.operationStats?.recordQuery({
				tableName: options.tableName,
				items: pageCount,
			});
			const nextToken =
				(result.LastEvaluatedKey as
					| Record<string, NativeAttributeValue>
					| undefined) ??
				undefined;

			return { nextToken };
		},
	});

	if (options.explainDynamoOperations) {
		const hasFilter = options.filterExpression ? "yes" : "no";
		const indexName = options.indexName ?? "(primary)";
		console.log(
			`DDB-OP QUERY-COUNT table=${options.tableName} index=${indexName} pages=${pageState.pages} count=${state.count} filter=${hasFilter}`,
		);
	}

	return state.count;
};
