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
    /**
     * Controls ScanCommand page limit behavior.
     * - "throw": enforce scanMaxPages and throw SCAN_PAGE_LIMIT when exceeded.
     * - "unbounded": ignore scanMaxPages page cap (continues scanning).
     *
     * @default "throw"
     */
    scanPageLimitMode?: "throw" | "unbounded" | undefined;
    /**
     * Print adapter query plans / execution strategy decisions to console.
     *
     * @default false
     */
    explainQueryPlans?: boolean | undefined;
    /**
     * Print DynamoDB operation summaries (Scan/Query/BatchGet/etc) to console.
     *
     * @default false
     */
    explainDynamoOperations?: boolean | undefined;
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
    scanPageLimitMode: "throw" | "unbounded";
    explainQueryPlans: boolean;
    explainDynamoOperations: boolean;
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