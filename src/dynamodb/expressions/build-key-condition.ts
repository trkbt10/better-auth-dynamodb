/**
 * @file Key condition builder for DynamoDB adapter.
 */
import type { DynamoDBWhere } from "../types";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { normalizeWhereOperator } from "./where-operator";

export const buildKeyCondition = (props: {
	model: string;
	where: DynamoDBWhere[] | undefined;
	getFieldName: (args: { model: string; field: string }) => string;
	indexNameResolver: (args: { model: string; field: string }) => string | undefined;
}): {
	keyConditionExpression: string;
	expressionAttributeNames: Record<string, string>;
	expressionAttributeValues: Record<string, NativeAttributeValue>;
	indexName?: string | undefined;
	remainingWhere: DynamoDBWhere[];
} | null => {
	const { model, where, getFieldName, indexNameResolver } = props;
	if (!where || where.length === 0) {
		return null;
	}
	const primaryKeyName = getFieldName({ model, field: "id" });
	const normalizedEntries = where.map((entry) => ({
		entry,
		operator: normalizeWhereOperator(entry.operator),
		fieldName: getFieldName({ model, field: entry.field }),
		connector: entry.connector?.toUpperCase() === "OR" ? "OR" : "AND",
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
	const remainingWhere = where.filter((entry) => entry !== indexEntry.entry);
	return {
		keyConditionExpression: "#pk = :pk",
		expressionAttributeNames: { "#pk": indexEntry.fieldName },
		expressionAttributeValues: {
			":pk": indexEntry.entry.value as NativeAttributeValue,
		},
		indexName,
		remainingWhere,
	};
};
