/**
 * @file Key condition builder for DynamoDB fetcher.
 */
import type { DynamoDBWhere } from "../types";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { normalizeWhereOperator } from "../where/where-operator";

export const buildKeyCondition = (props: {
	model: string;
	where: DynamoDBWhere[] | undefined;
	getFieldName: (args: { model: string; field: string }) => string;
}): {
	keyConditionExpression: string;
	expressionAttributeNames: Record<string, string>;
	expressionAttributeValues: Record<string, NativeAttributeValue>;
} | null => {
	const { model, where, getFieldName } = props;
	if (!where || where.length !== 1) {
		return null;
	}
	const entry = where[0]!;
	const operator = normalizeWhereOperator(entry.operator);
	if (operator !== "eq") {
		return null;
	}
	const primaryKeyName = getFieldName({ model, field: "id" });
	const fieldName = getFieldName({ model, field: entry.field });
	if (fieldName !== primaryKeyName) {
		return null;
	}
	return {
		keyConditionExpression: "#pk = :pk",
		expressionAttributeNames: { "#pk": primaryKeyName },
		expressionAttributeValues: {
			":pk": entry.value as NativeAttributeValue,
		},
	};
};
