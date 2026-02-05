/**
 * @file Collect per-execution DynamoDB operation statistics.
 */
export type DynamoDBOperationCounts = {
    scanCommands: number;
    queryCommands: number;
    batchGetCommands: number;
};
export type DynamoDBScanStats = {
    commands: number;
    items: number;
};
export type DynamoDBQueryStats = {
    commands: number;
    items: number;
};
export type DynamoDBBatchGetStats = {
    commands: number;
    keys: number;
    retries: number;
    items: number;
};
export type DynamoDBOperationStatsSnapshot = {
    totals: DynamoDBOperationCounts;
    scans: Record<string, DynamoDBScanStats>;
    queries: Record<string, DynamoDBQueryStats>;
    batchGets: Record<string, DynamoDBBatchGetStats>;
};
export type DynamoDBOperationStatsCollector = {
    recordScan: (props: {
        tableName: string;
        items: number;
    }) => void;
    recordQuery: (props: {
        tableName: string;
        items: number;
    }) => void;
    recordBatchGet: (props: {
        tableName: string;
        keys: number;
        items: number;
        isRetry: boolean;
    }) => void;
    snapshot: () => DynamoDBOperationStatsSnapshot;
};
export declare const createDynamoDBOperationStatsCollector: () => DynamoDBOperationStatsCollector;
export declare const formatDynamoDBOperationStats: (stats: DynamoDBOperationStatsSnapshot) => string;
//# sourceMappingURL=operation-stats.d.ts.map