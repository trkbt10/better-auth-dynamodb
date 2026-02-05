/**
 * @file DynamoDB query helpers for adapter.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { DynamoDBOperationStatsCollector } from "./operation-stats";
export type DynamoDBQueryOptions = {
    documentClient: DynamoDBDocumentClient;
    tableName: string;
    indexName?: string | undefined;
    keyConditionExpression: string;
    filterExpression: string | undefined;
    expressionAttributeNames: Record<string, string>;
    expressionAttributeValues: Record<string, NativeAttributeValue>;
    limit?: number | undefined;
    scanIndexForward?: boolean | undefined;
    explainDynamoOperations?: boolean | undefined;
    operationStats?: DynamoDBOperationStatsCollector | undefined;
};
export declare const queryItems: (options: DynamoDBQueryOptions) => Promise<Record<string, NativeAttributeValue>[]>;
export declare const queryCount: (options: Omit<DynamoDBQueryOptions, "limit">) => Promise<number>;
//# sourceMappingURL=query.d.ts.map