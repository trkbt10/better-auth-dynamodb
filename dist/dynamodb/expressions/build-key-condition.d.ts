/**
 * @file Key condition builder for DynamoDB adapter.
 */
import type { DynamoDBIndexKeySchema, DynamoDBWhere } from "../types";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
export declare const buildKeyCondition: (props: {
    model: string;
    where: DynamoDBWhere[] | undefined;
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
    indexNameResolver: (args: {
        model: string;
        field: string;
    }) => string | undefined;
    indexKeySchemaResolver?: ((args: {
        model: string;
        indexName: string;
    }) => DynamoDBIndexKeySchema | undefined) | undefined;
}) => {
    keyConditionExpression: string;
    expressionAttributeNames: Record<string, string>;
    expressionAttributeValues: Record<string, NativeAttributeValue>;
    indexName?: string | undefined;
    remainingWhere: DynamoDBWhere[];
} | null;
//# sourceMappingURL=build-key-condition.d.ts.map