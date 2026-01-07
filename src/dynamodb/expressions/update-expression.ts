/**
 * @file DynamoDB update expression builder.
 */
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { DynamoDBAdapterError } from "../errors/errors";

export type DynamoDBUpdateExpression = {
	updateExpression: string;
	expressionAttributeNames: Record<string, string>;
	expressionAttributeValues: Record<string, NativeAttributeValue>;
};

export const buildUpdateExpression = (
	update: Record<string, NativeAttributeValue>,
): DynamoDBUpdateExpression => {
	const entries = Object.entries(update).filter(
		([, value]) => value !== undefined,
	);

	if (entries.length === 0) {
		throw new DynamoDBAdapterError(
			"INVALID_UPDATE",
			"Update payload must include at least one defined value.",
		);
	}

	const expressionAttributeNames: Record<string, string> = {};
	const expressionAttributeValues: Record<string, NativeAttributeValue> = {};

	const setFragments = entries.map(([field, value], index) => {
		const fieldToken = `#u${index}`;
		const valueToken = `:u${index}`;
		expressionAttributeNames[fieldToken] = field;
		expressionAttributeValues[valueToken] = value;
		return `${fieldToken} = ${valueToken}`;
	});

	return {
		updateExpression: `SET ${setFragments.join(", ")}`,
		expressionAttributeNames,
		expressionAttributeValues,
	};
};
