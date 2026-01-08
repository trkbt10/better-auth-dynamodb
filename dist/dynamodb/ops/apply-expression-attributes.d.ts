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
export declare const applyExpressionAttributes: <T extends ExpressionCommandInput>(commandInput: T, props: ExpressionAttributes) => void;
export {};
//# sourceMappingURL=apply-expression-attributes.d.ts.map