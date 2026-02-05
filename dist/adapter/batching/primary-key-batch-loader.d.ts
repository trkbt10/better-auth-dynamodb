/**
 * @file Microtask-batched primary key loader for DynamoDB adapter.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { ResolvedDynamoDBAdapterConfig } from "../../adapter";
export type PrimaryKeyBatchLoader = {
    load: (args: {
        model: string;
        key: NativeAttributeValue;
    }) => Promise<Record<string, NativeAttributeValue> | null>;
};
export declare const createPrimaryKeyBatchLoader: (props: {
    documentClient: DynamoDBDocumentClient;
    adapterConfig: ResolvedDynamoDBAdapterConfig;
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
    getDefaultModelName: (model: string) => string;
}) => PrimaryKeyBatchLoader;
//# sourceMappingURL=primary-key-batch-loader.d.ts.map