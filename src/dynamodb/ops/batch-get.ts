/**
 * @file DynamoDB batch-get helpers for adapter.
 */
import { BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { DynamoDBAdapterError } from "../errors/errors";
import type { DynamoDBOperationStatsCollector } from "./operation-stats";

export type DynamoDBBatchGetOptions = {
	documentClient: DynamoDBDocumentClient;
	tableName: string;
	keyField: string;
	keys: NativeAttributeValue[];
	explainDynamoOperations?: boolean | undefined;
	operationStats?: DynamoDBOperationStatsCollector | undefined;
	maxAttempts?: number | undefined;
	backoffBaseDelayMs?: number | undefined;
	backoffMaxDelayMs?: number | undefined;
};

const chunkKeys = <T>(items: T[], size: number): T[][] => {
	if (size <= 0) {
		return [];
	}
	const chunkCount = Math.ceil(items.length / size);
	return Array.from({ length: chunkCount }, (_, index) =>
		items.slice(index * size, (index + 1) * size),
	);
};

const buildKeys = (
	keyField: string,
	keys: NativeAttributeValue[],
): Record<string, NativeAttributeValue>[] =>
	keys.map((value) => ({ [keyField]: value }));

const resolveUnprocessedKeys = (props: {
	unprocessed: Record<string, { Keys?: Record<string, NativeAttributeValue>[] }> | undefined;
	tableName: string;
}): Record<string, NativeAttributeValue>[] => {
	const unprocessed = props.unprocessed?.[props.tableName]?.Keys;
	if (!unprocessed) {
		return [];
	}
	return unprocessed;
};

export const batchGetItems = async (
	options: DynamoDBBatchGetOptions,
): Promise<Record<string, NativeAttributeValue>[]> => {
	if (options.keys.length === 0) {
		return [];
	}

	const maxAttempts = options.maxAttempts ?? 5;
	if (maxAttempts <= 0) {
		throw new DynamoDBAdapterError(
			"INVALID_BATCH_GET_ATTEMPTS",
			"BatchGet requires maxAttempts > 0.",
		);
	}
	const backoffBaseDelayMs = options.backoffBaseDelayMs ?? 10;
	const backoffMaxDelayMs = options.backoffMaxDelayMs ?? 200;
	if (backoffBaseDelayMs < 0 || backoffMaxDelayMs < 0) {
		throw new DynamoDBAdapterError(
			"INVALID_BATCH_GET_BACKOFF",
			"BatchGet backoff delays must be >= 0.",
		);
	}

	const items: Record<string, NativeAttributeValue>[] = [];
	const chunks = chunkKeys(options.keys, 100);
	const state = { requests: 0, retries: 0 };

	const sleep = async (ms: number): Promise<void> => {
		if (ms <= 0) {
			return;
		}
		await new Promise<void>((resolve) => {
			setTimeout(() => resolve(), ms);
		});
	};

	const computeBackoffMs = (attempt: number): number => {
		if (attempt <= 0) {
			return 0;
		}
		const computed = backoffBaseDelayMs * Math.pow(2, attempt - 1);
		return Math.min(backoffMaxDelayMs, computed);
	};

	const resolveRetryableErrorName = (error: unknown): string | undefined => {
		if (typeof error !== "object" || error === null) {
			return undefined;
		}
		const candidate = error as { name?: unknown; code?: unknown };
		if (typeof candidate.name === "string") {
			return candidate.name;
		}
		if (typeof candidate.code === "string") {
			return candidate.code;
		}
		return undefined;
	};

	const isRetryableBatchGetError = (error: unknown): boolean => {
		const name = resolveRetryableErrorName(error);
		if (!name) {
			return false;
		}
		const retryable = new Set<string>([
			"ProvisionedThroughputExceededException",
			"ThrottlingException",
			"RequestLimitExceeded",
			"TooManyRequestsException",
			"InternalServerError",
			"ServiceUnavailable",
		]);
		return retryable.has(name);
	};

	const fetchChunk = async (
		pendingKeys: Record<string, NativeAttributeValue>[],
		attempt: number,
	): Promise<Record<string, NativeAttributeValue>[]> => {
		if (pendingKeys.length === 0) {
			return [];
		}
		if (attempt >= maxAttempts) {
			throw new DynamoDBAdapterError(
				"BATCH_GET_UNPROCESSED",
				"Failed to resolve unprocessed keys after retries.",
			);
		}

		const sendBatchGet = async (
			keysToFetch: Record<string, NativeAttributeValue>[],
			currentAttempt: number,
		): Promise<unknown> => {
			state.requests += 1;
			if (currentAttempt > 0) {
				state.retries += 1;
			}
			try {
				return await options.documentClient.send(
					new BatchGetCommand({
						RequestItems: {
							[options.tableName]: {
								Keys: keysToFetch,
							},
						},
					}),
				);
			} catch (error) {
				options.operationStats?.recordBatchGet({
					tableName: options.tableName,
					keys: keysToFetch.length,
					items: 0,
					isRetry: currentAttempt > 0,
				});
				if (!isRetryableBatchGetError(error)) {
					throw error;
				}
				const nextAttempt = currentAttempt + 1;
				if (nextAttempt >= maxAttempts) {
					throw error;
				}
				await sleep(computeBackoffMs(nextAttempt));
				return sendBatchGet(keysToFetch, nextAttempt);
			}
		};

		const result = await sendBatchGet(pendingKeys, attempt);

		const typedResult = result as {
			Responses?: Record<string, unknown>;
			UnprocessedKeys?: Record<
				string,
				{ Keys?: Record<string, NativeAttributeValue>[] }
			>;
		};

		const responseItems =
			(typedResult.Responses?.[options.tableName] as
				| Record<string, NativeAttributeValue>[]
				| undefined) ?? [];
		options.operationStats?.recordBatchGet({
			tableName: options.tableName,
			keys: pendingKeys.length,
			items: responseItems.length,
			isRetry: attempt > 0,
		});

		const nextKeys = resolveUnprocessedKeys({
			unprocessed: typedResult.UnprocessedKeys,
			tableName: options.tableName,
		});

		if (nextKeys.length > 0) {
			const nextAttempt = attempt + 1;
			if (nextAttempt >= maxAttempts) {
				throw new DynamoDBAdapterError(
					"BATCH_GET_UNPROCESSED",
					"Failed to resolve unprocessed keys after retries.",
				);
			}
			await sleep(computeBackoffMs(nextAttempt));
			const nextItems = await fetchChunk(nextKeys, nextAttempt);
			return [...responseItems, ...nextItems];
		}

		return responseItems;
	};

	for (const chunk of chunks) {
		const pendingKeys = buildKeys(options.keyField, chunk);
		const responseItems = await fetchChunk(pendingKeys, 0);
		items.push(...responseItems);
	}

	if (options.explainDynamoOperations) {
		const chunkCount = Math.ceil(options.keys.length / 100);
		console.log(
			`DDB-OP BATCH-GET table=${options.tableName} key=${options.keyField} keys=${options.keys.length} chunks=${chunkCount} requests=${state.requests} retries=${state.retries} items=${items.length}`,
		);
	}

	return items;
};
