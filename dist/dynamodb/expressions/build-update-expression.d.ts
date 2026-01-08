/**
 * @file DynamoDB update expression builder.
 */
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
export type DynamoDBUpdateExpression = {
    updateExpression: string;
    expressionAttributeNames: Record<string, string>;
    expressionAttributeValues: Record<string, NativeAttributeValue>;
};
export declare const buildUpdateExpression: (update: Record<string, NativeAttributeValue>) => DynamoDBUpdateExpression;
//# sourceMappingURL=build-update-expression.d.ts.map