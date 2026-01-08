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

export type DynamoDBScanOptions = {
	documentClient: DynamoDBDocumentClient;
	tableName: string;
	filterExpression: string | undefined;
	expressionAttributeNames: Record<string, string>;
	expressionAttributeValues: Record<string, NativeAttributeValue>;
	limit?: number | undefined;
	maxPages?: number | undefined;
};

export const scanItems = async (
	options: DynamoDBScanOptions,
): Promise<Record<string, NativeAttributeValue>[]> => {
	const items: Record<string, NativeAttributeValue>[] = [];
	await paginate<Record<string, NativeAttributeValue>>({
		maxPages: options.maxPages ?? Number.POSITIVE_INFINITY,
		onMaxPages: () => {
			throw new DynamoDBAdapterError(
				"SCAN_PAGE_LIMIT",
				"Scan exceeded the configured page limit.",
			);
		},
		fetchPage: async (lastEvaluatedKey) => {
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

export const scanCount = async (
	options: Omit<DynamoDBScanOptions, "limit">,
): Promise<number> => {
	const state = { count: 0 };

	await paginate<Record<string, NativeAttributeValue>>({
		maxPages: options.maxPages ?? Number.POSITIVE_INFINITY,
		onMaxPages: () => {
			throw new DynamoDBAdapterError(
				"SCAN_PAGE_LIMIT",
				"Scan exceeded the configured page limit.",
			);
		},
		fetchPage: async (lastEvaluatedKey) => {
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
