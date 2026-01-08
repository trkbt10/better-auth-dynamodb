import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
export type DynamoDBBatchGetOptions = {
    documentClient: DynamoDBDocumentClient;
    tableName: string;
    keyField: string;
    keys: NativeAttributeValue[];
};
export declare const batchGetItems: (options: DynamoDBBatchGetOptions) => Promise<Record<string, NativeAttributeValue>[]>;
//# sourceMappingURL=batch-get.d.ts.map