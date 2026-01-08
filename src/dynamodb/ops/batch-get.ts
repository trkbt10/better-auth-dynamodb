/**
 * @file DynamoDB batch-get helpers for adapter.
 */
import { BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { DynamoDBAdapterError } from "../errors/errors";

export type DynamoDBBatchGetOptions = {
	documentClient: DynamoDBDocumentClient;
	tableName: string;
	keyField: string;
	keys: NativeAttributeValue[];
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

	const items: Record<string, NativeAttributeValue>[] = [];
	const chunks = chunkKeys(options.keys, 100);
	const maxAttempts = 5;

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

		const result = await options.documentClient.send(
			new BatchGetCommand({
				RequestItems: {
					[options.tableName]: {
						Keys: pendingKeys,
					},
				},
			}),
		);

		const responseItems =
			(result.Responses?.[options.tableName] as
				| Record<string, NativeAttributeValue>[]
				| undefined) ?? [];

		const nextKeys = resolveUnprocessedKeys({
			unprocessed: result.UnprocessedKeys,
			tableName: options.tableName,
		});

		const nextItems = await fetchChunk(nextKeys, attempt + 1);
		return [...responseItems, ...nextItems];
	};

	for (const chunk of chunks) {
		const pendingKeys = buildKeys(options.keyField, chunk);
		const responseItems = await fetchChunk(pendingKeys, 0);
		items.push(...responseItems);
	}

	return items;
};
