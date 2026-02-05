/**
 * @file Key condition builder for DynamoDB adapter.
 */
import type { DynamoDBIndexKeySchema, DynamoDBWhere } from "../types";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { normalizeWhereOperator } from "./where-operator";

export const buildKeyCondition = (props: {
	model: string;
	where: DynamoDBWhere[] | undefined;
	getFieldName: (args: { model: string; field: string }) => string;
	indexNameResolver: (args: { model: string; field: string }) => string | undefined;
	indexKeySchemaResolver?:
		| ((args: { model: string; indexName: string }) => DynamoDBIndexKeySchema | undefined)
		| undefined;
}): {
	keyConditionExpression: string;
	expressionAttributeNames: Record<string, string>;
	expressionAttributeValues: Record<string, NativeAttributeValue>;
	indexName?: string | undefined;
	remainingWhere: DynamoDBWhere[];
} | null => {
	const { model, where, getFieldName, indexNameResolver, indexKeySchemaResolver } =
		props;
	if (!where || where.length === 0) {
		return null;
	}
	const primaryKeyName = getFieldName({ model, field: "id" });
	const resolveConnector = (
		connector: DynamoDBWhere["connector"],
	): "AND" | "OR" => {
		if (connector && connector.toUpperCase() === "OR") {
			return "OR";
		}
		return "AND";
	};
	const normalizedEntries = where.map((entry) => ({
		entry,
		operator: normalizeWhereOperator(entry.operator),
		fieldName: getFieldName({ model, field: entry.field }),
		connector: resolveConnector(entry.connector),
	}));

	const primaryKeyEntry = normalizedEntries.find(
		({ operator, fieldName, connector }) =>
			operator === "eq" && connector === "AND" && fieldName === primaryKeyName,
	);
	if (primaryKeyEntry) {
		const remainingWhere = where.filter(
			(entry) => entry !== primaryKeyEntry.entry,
		);
		return {
			keyConditionExpression: "#pk = :pk",
			expressionAttributeNames: { "#pk": primaryKeyName },
			expressionAttributeValues: {
				":pk": primaryKeyEntry.entry.value as NativeAttributeValue,
			},
			remainingWhere,
		};
	}

	const hasSortKeyEntry = (sortKey: string | undefined): boolean => {
		if (!sortKey) {
			return false;
		}
		return normalizedEntries.some((entry) => {
			if (entry.connector !== "AND") {
				return false;
			}
			if (entry.operator !== "eq") {
				return false;
			}
			return entry.fieldName === sortKey;
		});
	};

	const resolveIndexKeySchema = (indexName: string) => {
		if (!indexKeySchemaResolver) {
			return undefined;
		}
		return indexKeySchemaResolver({ model, indexName });
	};

	const indexCandidates = normalizedEntries
		.filter((candidate) => {
			if (candidate.connector !== "AND") {
				return false;
			}
			if (candidate.operator !== "eq") {
				return false;
			}
			return Boolean(indexNameResolver({ model, field: candidate.entry.field }));
		})
		.map((candidate) => {
			const indexName = indexNameResolver({ model, field: candidate.entry.field });
			if (!indexName) {
				return null;
			}
			const keySchema = resolveIndexKeySchema(indexName);
			const sortKey = keySchema?.sortKey;
			const matchedSortKey = hasSortKeyEntry(sortKey);
			return {
				candidate,
				indexName,
				score: matchedSortKey ? 2 : 1,
			};
		})
		.filter((entry): entry is Exclude<typeof entry, null> => entry !== null);

	const resolveBestIndexEntry = () => {
		const best = indexCandidates.reduce<
			{ candidate: typeof normalizedEntries[number]; indexName: string; score: number } | undefined
		>((acc, candidate) => {
			if (!acc) {
				return candidate;
			}
			if (candidate.score > acc.score) {
				return candidate;
			}
			return acc;
		}, undefined);
		return best;
	};

	const bestIndexEntry = resolveBestIndexEntry();
	if (!bestIndexEntry) {
		return null;
	}

	const indexName = bestIndexEntry.indexName;
	const indexEntryResolved = bestIndexEntry.candidate;

	const resolveKeySchema = (): { sortKey?: string | undefined } | undefined => {
		if (!indexKeySchemaResolver) {
			return undefined;
		}
		return indexKeySchemaResolver({ model, indexName });
	};
	const resolveSortKeyEntry = (
		sortKey: string | undefined,
	): typeof normalizedEntries[number] | undefined => {
		if (!sortKey) {
			return undefined;
		}
		return normalizedEntries.find(
			({ operator, fieldName, connector }) =>
				operator === "eq" && connector === "AND" && fieldName === sortKey,
		);
	};
	const resolveKeyConditionExpression = (hasSortKey: boolean): string => {
		if (!hasSortKey) {
			return "#pk = :pk";
		}
		return "#pk = :pk AND #sk = :sk";
	};
	const buildExpressionAttributeNames = (props: {
		partitionKey: string;
		sortKey?: string | undefined;
	}): Record<string, string> => {
		if (!props.sortKey) {
			return { "#pk": props.partitionKey };
		}
		return {
			"#pk": props.partitionKey,
			"#sk": props.sortKey,
		};
	};
	const buildExpressionAttributeValues = (props: {
		partitionValue: NativeAttributeValue;
		sortValue?: NativeAttributeValue | undefined;
	}): Record<string, NativeAttributeValue> => {
		if (props.sortValue === undefined) {
			return { ":pk": props.partitionValue };
		}
		return {
			":pk": props.partitionValue,
			":sk": props.sortValue,
		};
	};

	const keySchema = resolveKeySchema();
	const sortKeyName = keySchema?.sortKey;
	const sortKeyEntry = resolveSortKeyEntry(sortKeyName);
	const resolveSortKeyName = (entry: typeof sortKeyEntry): string | undefined => {
		if (!entry) {
			return undefined;
		}
		return sortKeyName;
	};
	const resolveSortKeyValue = (
		entry: typeof sortKeyEntry,
	): NativeAttributeValue | undefined => {
		if (!entry) {
			return undefined;
		}
		return entry.entry.value as NativeAttributeValue;
	};
	const remainingWhere = where.filter(
		(entry) => entry !== indexEntryResolved.entry && entry !== sortKeyEntry?.entry,
	);
	const keyConditionExpression = resolveKeyConditionExpression(
		Boolean(sortKeyEntry),
	);
	const expressionAttributeNames = buildExpressionAttributeNames({
		partitionKey: indexEntryResolved.fieldName,
		sortKey: resolveSortKeyName(sortKeyEntry),
	});
	const expressionAttributeValues = buildExpressionAttributeValues({
		partitionValue: indexEntryResolved.entry.value as NativeAttributeValue,
		sortValue: resolveSortKeyValue(sortKeyEntry),
	});

	return {
		keyConditionExpression,
		expressionAttributeNames,
		expressionAttributeValues,
		indexName,
		remainingWhere,
	};
};
