/**
 * @file Conditional single-item writes.
 *
 * A write whose ConditionExpression fails is an expected outcome for the
 * adapter (the row changed or disappeared after it was read), so it is
 * reported as a result instead of an exception.
 */
import {
	DeleteCommand,
	UpdateCommand,
	type DeleteCommandInput,
	type DynamoDBDocumentClient,
	type UpdateCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";

export type ConditionalWriteResult =
	| {
			applied: true;
			attributes: Record<string, NativeAttributeValue> | undefined;
	  }
	| { applied: false };

export const isConditionalCheckFailure = (error: unknown): boolean => {
	if (!(error instanceof Error)) {
		return false;
	}
	return error.name === "ConditionalCheckFailedException";
};

export const sendConditionalDelete = async (
	documentClient: DynamoDBDocumentClient,
	input: DeleteCommandInput,
): Promise<ConditionalWriteResult> => {
	try {
		const output = await documentClient.send(new DeleteCommand(input));
		return { applied: true, attributes: output.Attributes };
	} catch (error) {
		if (isConditionalCheckFailure(error)) {
			return { applied: false };
		}
		throw error;
	}
};

export const sendConditionalUpdate = async (
	documentClient: DynamoDBDocumentClient,
	input: UpdateCommandInput,
): Promise<ConditionalWriteResult> => {
	try {
		const output = await documentClient.send(new UpdateCommand(input));
		return { applied: true, attributes: output.Attributes };
	} catch (error) {
		if (isConditionalCheckFailure(error)) {
			return { applied: false };
		}
		throw error;
	}
};
