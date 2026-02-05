/**
 * @file DynamoDB scan helpers for adapter.
 */
import type {
	DynamoDBDocumentClient,
	ScanCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { applyExpressionAttributes } from "./apply-expression-attributes";
import { paginate } from "./paginate";
import { resolveRemainingLimit } from "./resolve-remaining-limit";
import { DynamoDBAdapterError } from "../errors/errors";
import type { DynamoDBOperationStatsCollector } from "./operation-stats";

export type DynamoDBScanOptions = {
	documentClient: DynamoDBDocumentClient;
	tableName: string;
	filterExpression: string | undefined;
	expressionAttributeNames: Record<string, string>;
	expressionAttributeValues: Record<string, NativeAttributeValue>;
	limit?: number | undefined;
	maxPages?: number | undefined;
	explainDynamoOperations?: boolean | undefined;
	operationStats?: DynamoDBOperationStatsCollector | undefined;
};

export const scanItems = async (
	options: DynamoDBScanOptions,
): Promise<Record<string, NativeAttributeValue>[]> => {
	const items: Record<string, NativeAttributeValue>[] = [];
	const state = { pages: 0 };
	await paginate<Record<string, NativeAttributeValue>>({
		maxPages: options.maxPages ?? Number.POSITIVE_INFINITY,
		onMaxPages: () => {
			throw new DynamoDBAdapterError(
				"SCAN_PAGE_LIMIT",
				"Scan exceeded the configured page limit.",
			);
		},
		fetchPage: async (lastEvaluatedKey) => {
			state.pages += 1;
			const remaining = resolveRemainingLimit(options.limit, items.length);

			if (remaining === 0) {
				return { shouldStop: true };
			}

			const commandInput: ScanCommandInput = {
				TableName: options.tableName,
			};

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
				new ScanCommand(commandInput),
			);
			const pageItems = (result.Items ?? []) as Record<string, unknown>[];
			items.push(...pageItems);
			options.operationStats?.recordScan({
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
		const maxPages =
			options.maxPages === undefined ? "∞" : String(options.maxPages);
		const limit = options.limit === undefined ? "∞" : String(options.limit);
		const hasFilter = options.filterExpression ? "yes" : "no";
		console.log(
			`DDB-OP SCAN table=${options.tableName} pages=${state.pages} items=${items.length} limit=${limit} maxPages=${maxPages} filter=${hasFilter}`,
		);
	}

	return items;
};

export const scanCount = async (
	options: Omit<DynamoDBScanOptions, "limit">,
): Promise<number> => {
	const state = { count: 0 };
	const pageState = { pages: 0 };

	await paginate<Record<string, NativeAttributeValue>>({
		maxPages: options.maxPages ?? Number.POSITIVE_INFINITY,
		onMaxPages: () => {
			throw new DynamoDBAdapterError(
				"SCAN_PAGE_LIMIT",
				"Scan exceeded the configured page limit.",
			);
		},
		fetchPage: async (lastEvaluatedKey) => {
			pageState.pages += 1;
			const commandInput: ScanCommandInput = {
				TableName: options.tableName,
				Select: "COUNT",
			};

			applyExpressionAttributes(commandInput, {
				filterExpression: options.filterExpression,
				expressionAttributeNames: options.expressionAttributeNames,
				expressionAttributeValues: options.expressionAttributeValues,
			});

			if (lastEvaluatedKey) {
				commandInput.ExclusiveStartKey = lastEvaluatedKey;
			}

			const result = await options.documentClient.send(
				new ScanCommand(commandInput),
			);
			const pageCount = result.Count ?? 0;
			state.count += pageCount;
			options.operationStats?.recordScan({
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
		const maxPages =
			options.maxPages === undefined ? "∞" : String(options.maxPages);
		const hasFilter = options.filterExpression ? "yes" : "no";
		console.log(
			`DDB-OP SCAN-COUNT table=${options.tableName} pages=${pageState.pages} count=${state.count} maxPages=${maxPages} filter=${hasFilter}`,
		);
	}

	return state.count;
};
