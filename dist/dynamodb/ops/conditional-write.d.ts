/**
 * @file Conditional single-item writes.
 *
 * A write whose ConditionExpression fails is an expected outcome for the
 * adapter (the row changed or disappeared after it was read), so it is
 * reported as a result instead of an exception.
 */
import { type DeleteCommandInput, type DynamoDBDocumentClient, type UpdateCommandInput } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
export type ConditionalWriteResult = {
    applied: true;
    attributes: Record<string, NativeAttributeValue> | undefined;
} | {
    applied: false;
};
export declare const isConditionalCheckFailure: (error: unknown) => boolean;
export declare const sendConditionalDelete: (documentClient: DynamoDBDocumentClient, input: DeleteCommandInput) => Promise<ConditionalWriteResult>;
export declare const sendConditionalUpdate: (documentClient: DynamoDBDocumentClient, input: UpdateCommandInput) => Promise<ConditionalWriteResult>;
//# sourceMappingURL=conditional-write.d.ts.map