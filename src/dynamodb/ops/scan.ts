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
	const state = {
		lastEvaluatedKey: undefined as
			| Record<string, NativeAttributeValue>
			| undefined,
		pageCount: 0,
	};

	for (;;) {
		if (
			options.maxPages !== undefined &&
			state.pageCount >= options.maxPages
		) {
			throw new DynamoDBAdapterError(
				"SCAN_PAGE_LIMIT",
				"Scan exceeded the configured page limit.",
			);
		}
		state.pageCount += 1;

		const remaining = resolveRemainingLimit(options.limit, items.length);

		if (remaining === 0) {
			break;
		}

		const commandInput: ScanCommandInput = {
			TableName: options.tableName,
		};

		applyExpressionAttributes(commandInput, {
			filterExpression: options.filterExpression,
			expressionAttributeNames: options.expressionAttributeNames,
			expressionAttributeValues: options.expressionAttributeValues,
		});

		if (state.lastEvaluatedKey) {
			commandInput.ExclusiveStartKey = state.lastEvaluatedKey;
		}

		if (remaining !== undefined) {
			commandInput.Limit = remaining;
		}

		const result = await options.documentClient.send(
			new ScanCommand(commandInput),
		);
		const pageItems = (result.Items ?? []) as Record<string, unknown>[];
		items.push(...pageItems);

		state.lastEvaluatedKey =
			(result.LastEvaluatedKey as
				| Record<string, NativeAttributeValue>
				| undefined) ??
			undefined;

		if (!state.lastEvaluatedKey) {
			break;
		}
	}

	return items;
};

export const scanCount = async (
	options: Omit<DynamoDBScanOptions, "limit">,
): Promise<number> => {
	const state = {
		lastEvaluatedKey: undefined as
			| Record<string, NativeAttributeValue>
			| undefined,
		count: 0,
		pageCount: 0,
	};

	for (;;) {
		if (
			options.maxPages !== undefined &&
			state.pageCount >= options.maxPages
		) {
			throw new DynamoDBAdapterError(
				"SCAN_PAGE_LIMIT",
				"Scan exceeded the configured page limit.",
			);
		}
		state.pageCount += 1;

		const commandInput: ScanCommandInput = {
			TableName: options.tableName,
			Select: "COUNT",
		};

		applyExpressionAttributes(commandInput, {
			filterExpression: options.filterExpression,
			expressionAttributeNames: options.expressionAttributeNames,
			expressionAttributeValues: options.expressionAttributeValues,
		});

		if (state.lastEvaluatedKey) {
			commandInput.ExclusiveStartKey = state.lastEvaluatedKey;
		}

		const result = await options.documentClient.send(
			new ScanCommand(commandInput),
		);
		state.count += result.Count ?? 0;
		state.lastEvaluatedKey =
			(result.LastEvaluatedKey as
				| Record<string, NativeAttributeValue>
				| undefined) ??
			undefined;

		if (!state.lastEvaluatedKey) {
			break;
		}
	}

	return state.count;
};
