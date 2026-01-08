/**
 * @file DynamoDB filter expression builder.
 */
import type { DynamoDBWhere } from "../types";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
export type DynamoDBFilterExpression = {
    filterExpression: string | undefined;
    expressionAttributeNames: Record<string, string>;
    expressionAttributeValues: Record<string, NativeAttributeValue>;
    requiresClientFilter: boolean;
};
export declare const buildFilterExpression: (props: {
    where?: DynamoDBWhere[] | undefined;
    model: string;
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
}) => DynamoDBFilterExpression;
//# sourceMappingURL=build-filter-expression.d.ts.map