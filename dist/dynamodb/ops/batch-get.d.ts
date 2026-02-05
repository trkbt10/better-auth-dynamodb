import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { DynamoDBOperationStatsCollector } from "./operation-stats";
export type DynamoDBBatchGetOptions = {
    documentClient: DynamoDBDocumentClient;
    tableName: string;
    keyField: string;
    keys: NativeAttributeValue[];
    explainDynamoOperations?: boolean | undefined;
    operationStats?: DynamoDBOperationStatsCollector | undefined;
    maxAttempts?: number | undefined;
    backoffBaseDelayMs?: number | undefined;
    backoffMaxDelayMs?: number | undefined;
};
export declare const batchGetItems: (options: DynamoDBBatchGetOptions) => Promise<Record<string, NativeAttributeValue>[]>;
//# sourceMappingURL=batch-get.d.ts.map