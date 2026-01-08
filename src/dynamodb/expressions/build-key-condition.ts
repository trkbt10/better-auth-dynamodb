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

	const hasOrConnector = normalizedEntries.some(
		({ connector }) => connector === "OR",
	);
	if (hasOrConnector) {
		return null;
	}

	const primaryKeyEntry = normalizedEntries.find(
		({ operator, fieldName }) =>
			operator === "eq" && fieldName === primaryKeyName,
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

	const indexEntry = normalizedEntries.find(({ operator, fieldName, entry }) => {
		if (operator !== "eq") {
			return false;
		}
		const indexName = indexNameResolver({ model, field: entry.field });
		if (!indexName) {
			return false;
		}
		return fieldName.length > 0;
	});

	if (!indexEntry) {
		return null;
	}

	const indexName = indexNameResolver({
		model,
		field: indexEntry.entry.field,
	});
	if (!indexName) {
		return null;
	}

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
			({ operator, fieldName }) =>
				operator === "eq" && fieldName === sortKey,
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
		(entry) => entry !== indexEntry.entry && entry !== sortKeyEntry?.entry,
	);
	const keyConditionExpression = resolveKeyConditionExpression(
		Boolean(sortKeyEntry),
	);
	const expressionAttributeNames = buildExpressionAttributeNames({
		partitionKey: indexEntry.fieldName,
		sortKey: resolveSortKeyName(sortKeyEntry),
	});
	const expressionAttributeValues = buildExpressionAttributeValues({
		partitionValue: indexEntry.entry.value as NativeAttributeValue,
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
