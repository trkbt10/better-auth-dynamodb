/**
 * @file DynamoDB patch update expression builder.
 */
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
export declare const buildPatchUpdateExpression: (props: {
    prev: Record<string, unknown>;
    next: Record<string, unknown>;
}) => {
    updateExpression: string;
    expressionAttributeNames: Record<string, string>;
    expressionAttributeValues: Record<string, NativeAttributeValue>;
};
//# sourceMappingURL=build-patch-update-expression.d.ts.map