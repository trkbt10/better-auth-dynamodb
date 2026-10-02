/**
 * @file DynamoDB update expression builder.
 *
 * An update assigns the attributes it is given, each as a whole value: a
 * defined value becomes a `SET`, `undefined` a `REMOVE`. The expression is
 * built from the update alone, never from a comparison with the row that was
 * read. A diff against that row would skip a value that looked unchanged and
 * patch lists and maps element by element, both of which go wrong as soon as
 * another writer changed the row in between.
 */
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { DynamoDBAdapterError } from "../errors/errors";

export type DynamoDBUpdateExpression = {
	updateExpression: string;
	expressionAttributeNames: Record<string, string>;
	expressionAttributeValues: Record<string, NativeAttributeValue>;
};

export const buildUpdateExpression = (
	update: Record<string, NativeAttributeValue | undefined>,
): DynamoDBUpdateExpression => {
	const entries = Object.entries(update).map(([field, value], index) => ({
		field,
		value,
		nameToken: `#u${index}`,
		valueToken: `:u${index}`,
	}));

	if (entries.length === 0) {
		throw new DynamoDBAdapterError(
			"INVALID_UPDATE",
			"Update payload must include at least one attribute.",
		);
	}

	const assigned = entries.filter((entry) => entry.value !== undefined);
	const removed = entries.filter((entry) => entry.value === undefined);
	const clauses = [
		{
			keyword: "SET",
			parts: assigned.map((entry) => `${entry.nameToken} = ${entry.valueToken}`),
		},
		{ keyword: "REMOVE", parts: removed.map((entry) => entry.nameToken) },
	].filter((clause) => clause.parts.length > 0);

	return {
		updateExpression: clauses
			.map((clause) => `${clause.keyword} ${clause.parts.join(", ")}`)
			.join(" "),
		expressionAttributeNames: Object.fromEntries(
			entries.map((entry) => [entry.nameToken, entry.field]),
		),
		expressionAttributeValues: Object.fromEntries(
			assigned.map((entry) => [entry.valueToken, entry.value]),
		),
	};
};
