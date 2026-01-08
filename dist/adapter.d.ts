/**
 * @file DynamoDB adapter implementation for Better Auth.
 */
import type { BetterAuthOptions } from "@better-auth/core";
import type { DBAdapter, DBAdapterDebugLogOption, DBAdapterFactoryConfig } from "@better-auth/core/db/adapter";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBIndexKeySchema } from "./dynamodb/types";
export type DynamoDBTableNameResolver = (modelName: string) => string;
/**
 * Options inherited from Better Auth's DBAdapterFactoryConfig.
 */
type InheritedAdapterFactoryConfig = Pick<DBAdapterFactoryConfig, "debugLogs" | "usePlural" | "customIdGenerator" | "disableIdGeneration" | "mapKeysTransformInput" | "mapKeysTransformOutput" | "customTransformInput" | "customTransformOutput">;
/**
 * DynamoDB-specific adapter configuration.
 */
type DynamoDBSpecificConfig = {
    documentClient: DynamoDBDocumentClient;
    tableNamePrefix?: string | undefined;
    tableNameResolver?: DynamoDBTableNameResolver | undefined;
    scanMaxPages?: number | undefined;
    indexNameResolver: (props: {
        model: string;
        field: string;
    }) => string | undefined;
    indexKeySchemaResolver?: ((props: {
        model: string;
        indexName: string;
    }) => DynamoDBIndexKeySchema | undefined) | undefined;
    /**
     * Enable adapter-layer transactions.
     * Unlike DBAdapterFactoryConfig.transaction (which accepts a function),
     * this is a simple boolean that enables DynamoDB TransactWriteItems.
     */
    transaction?: boolean | undefined;
};
export type DynamoDBAdapterConfig = DynamoDBSpecificConfig & InheritedAdapterFactoryConfig;
export type ResolvedDynamoDBAdapterConfig = {
    documentClient: DynamoDBDocumentClient;
    debugLogs: DBAdapterDebugLogOption | undefined;
    usePlural: boolean;
    tableNamePrefix?: string | undefined;
    tableNameResolver?: DynamoDBTableNameResolver | undefined;
    scanMaxPages?: number | undefined;
    indexNameResolver: (props: {
        model: string;
        field: string;
    }) => string | undefined;
    indexKeySchemaResolver?: ((props: {
        model: string;
        indexName: string;
    }) => DynamoDBIndexKeySchema | undefined) | undefined;
    transaction: boolean;
};
export declare const dynamodbAdapter: (config: DynamoDBAdapterConfig) => (options: BetterAuthOptions) => DBAdapter<BetterAuthOptions>;
export {};
//# sourceMappingURL=adapter.d.ts.map