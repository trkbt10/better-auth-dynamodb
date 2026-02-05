/**
 * @file DynamoDB scan helpers for adapter.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { DynamoDBOperationStatsCollector } from "./operation-stats";
export type DynamoDBScanOptions = {
    documentClient: DynamoDBDocumentClient;
    tableName: string;
    filterExpression: string | undefined;
    expressionAttributeNames: Record<string, string>;
    expressionAttributeValues: Record<string, NativeAttributeValue>;
    limit?: number | undefined;
    maxPages?: number | undefined;
    explainDynamoOperations?: boolean | undefined;
    operationStats?: DynamoDBOperationStatsCollector | undefined;
};
export declare const scanItems: (options: DynamoDBScanOptions) => Promise<Record<string, NativeAttributeValue>[]>;
export declare const scanCount: (options: Omit<DynamoDBScanOptions, "limit">) => Promise<number>;
//# sourceMappingURL=scan.d.ts.map