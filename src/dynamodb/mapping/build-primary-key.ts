/**
 * @file DynamoDB key helpers.
 */
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { DynamoDBAdapterError } from "../errors/errors";

export const buildPrimaryKey = (props: {
	item: Record<string, NativeAttributeValue>;
	keyField: string;
}): Record<string, NativeAttributeValue> => {
	const { item, keyField } = props;
	if (!(keyField in item)) {
		throw new DynamoDBAdapterError(
			"MISSING_PRIMARY_KEY",
			`Item is missing primary key field "${keyField}".`,
		);
	}
	return { [keyField]: item[keyField] };
};
