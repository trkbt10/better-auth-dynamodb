/**
 * @file Shared expression attribute application for DynamoDB commands.
 */
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";

type ExpressionAttributes = {
	filterExpression: string | undefined;
	expressionAttributeNames: Record<string, string>;
	expressionAttributeValues: Record<string, NativeAttributeValue>;
};

type ExpressionCommandInput = {
	FilterExpression?: string | undefined;
	ExpressionAttributeNames?: Record<string, string> | undefined;
	ExpressionAttributeValues?: Record<string, NativeAttributeValue> | undefined;
};

export const applyExpressionAttributes = <T extends ExpressionCommandInput>(
	commandInput: T,
	props: ExpressionAttributes,
): void => {
	if (props.filterExpression) {
		commandInput.FilterExpression = props.filterExpression;
	}

	if (Object.keys(props.expressionAttributeNames).length > 0) {
		commandInput.ExpressionAttributeNames = props.expressionAttributeNames;
	}

	if (Object.keys(props.expressionAttributeValues).length > 0) {
		commandInput.ExpressionAttributeValues = props.expressionAttributeValues;
	}
};
