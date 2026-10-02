import { BetterAuthOptions } from '@better-auth/core';
import { DBAdapterFactoryConfig, DBAdapter } from '@better-auth/core/db/adapter';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { AttributeDefinition, KeySchemaElement, BillingMode, GlobalSecondaryIndex, DynamoDBClient, waitUntilTableExists } from '@aws-sdk/client-dynamodb';
import { BetterAuthDBSchema } from '@better-auth/core/db';

/**
 * @file DynamoDB adapter shared types.
 */

type TableDefinition = {
    attributeDefinitions: AttributeDefinition[];
    keySchema: KeySchemaElement[];
    billingMode: BillingMode | undefined;
    globalSecondaryIndexes?: GlobalSecondaryIndex[] | undefined;
};
type IndexMapping = {
    indexName: string;
    partitionKey: string;
    sortKey?: string | undefined;
};
type TableSchema = {
    tableName: string;
    tableDefinition: TableDefinition;
    indexMappings: IndexMapping[];
};
type DynamoDBIndexKeySchema = {
    partitionKey: string;
    sortKey?: string | undefined;
};
type IndexResolverBundle = {
    indexNameResolver: (props: {
        model: string;
        field: string;
    }) => string | undefined;
    indexKeySchemaResolver: (props: {
        model: string;
        indexName: string;
    }) => DynamoDBIndexKeySchema | undefined;
};

/**
 * @file DynamoDB adapter implementation for Better Auth.
 */

type DynamoDBTableNameResolver = (modelName: string) => string;
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
type DynamoDBAdapterConfig = DynamoDBSpecificConfig & InheritedAdapterFactoryConfig;
declare const dynamodbAdapter: (config: DynamoDBAdapterConfig) => (options: BetterAuthOptions) => DBAdapter<BetterAuthOptions>;

/**
 * @file DynamoDB adapter error definitions.
 */
type DynamoDBAdapterErrorCode = "MISSING_CLIENT" | "MISSING_TABLE_RESOLVER" | "MISSING_PRIMARY_KEY" | "MISSING_WHERE_INPUT" | "MISSING_QUERY_PLAN_INPUT" | "MISSING_JOIN_PLAN_INPUT" | "MISSING_STRATEGY_INPUT" | "MISSING_JOIN_STRATEGY_INPUT" | "MISSING_JOIN_EXECUTION_INPUT" | "MISSING_EXECUTOR_INPUT" | "MISSING_INDEX_RESOLVER" | "MISSING_KEY_CONDITION" | "MISSING_SCAN_LIMIT" | "SCAN_PAGE_LIMIT" | "BATCH_GET_UNPROCESSED" | "INVALID_BATCH_GET_ATTEMPTS" | "INVALID_BATCH_GET_BACKOFF" | "MISSING_TABLE_SCHEMA" | "MISSING_ATTRIBUTE_DEFINITION" | "ATTRIBUTE_DEFINITION_MISMATCH" | "TABLE_WAIT_TIMEOUT" | "TRANSACTION_LIMIT" | "ATOMIC_WRITE_CONTENTION" | "DUPLICATE_PRIMARY_KEY" | "INVALID_RATE_LIMIT_KEY" | "UNSUPPORTED_OPERATOR" | "UNSUPPORTED_JOIN" | "UNSUPPORTED_TRANSACTION" | "INVALID_UPDATE";
/**
 * Adapter error with a stable error code.
 */
declare class DynamoDBAdapterError extends Error {
    code: DynamoDBAdapterErrorCode;
    constructor(code: DynamoDBAdapterErrorCode, message: string);
}

/**
 * @file DynamoDB table schema application helpers for Better Auth adapter.
 */

type WaiterConfiguration = Omit<Parameters<typeof waitUntilTableExists>[0], "client">;
type ApplyTableSchemasOptions = {
    client: DynamoDBClient;
    tables: TableSchema[];
    wait?: WaiterConfiguration | undefined;
};
type ApplyTableSchemasResult = {
    createdTables: string[];
    updatedTables: string[];
};
declare const applyTableSchemas: (options: ApplyTableSchemasOptions) => Promise<ApplyTableSchemasResult>;

/**
 * @file DynamoDB table creation helpers for Better Auth adapter.
 */

/**
 * @deprecated Use `applyTableSchemas` instead. This helper now applies GSI schema changes too.
 */
declare const createTables: (options: ApplyTableSchemasOptions) => Promise<string[]>;

/**
 * @file Core DynamoDB table schemas provided by this adapter.
 *
 * These are hand-crafted table definitions for Better Auth's core tables
 * (user, session, account, verification) with DynamoDB-optimized GSI configurations.
 *
 * Use these schemas when:
 * - You want explicit control over table structure
 * - You're not using Better Auth plugins that require additional tables
 * - You prefer hand-crafted definitions over auto-generation
 *
 * For plugin support, use `generateTableSchemas()` from `./from-better-auth.ts` instead.
 */

/**
 * Core table schemas for Better Auth with DynamoDB-optimized GSIs.
 *
 * Includes:
 * - user: email, username GSIs
 * - session: userId+createdAt, token+createdAt composite GSIs
 * - account: accountId, userId, providerId+accountId GSIs
 * - verification: identifier+createdAt composite GSI
 */
declare const coreTableSchemas: TableSchema[];
/**
 * @deprecated Use `coreTableSchemas` instead. Will be removed in a future version.
 */
declare const multiTableSchemas: TableSchema[];

/**
 * @file Schema extensions for Better Auth plugins.
 *
 * Some Better Auth plugins have incomplete schema definitions (missing indexes/references).
 * This file provides extensions to ensure proper GSI generation for DynamoDB.
 *
 * References:
 * - deviceAuthorization: https://www.better-auth.com/docs/plugins/device-authorization
 *   Documentation states "userId references the user table" but schema lacks references property.
 */
/**
 * Field extension to add missing properties to Better Auth schema fields.
 */
type FieldExtension = {
    /** Add index property to field */
    index?: boolean;
    /** Add unique property to field */
    unique?: boolean;
    /** Add references property to field */
    references?: {
        model: string;
        field: string;
    };
};
/**
 * Table extension mapping field names to their extensions.
 */
type TableExtension = Record<string, FieldExtension>;
/**
 * Schema extensions for all tables.
 * Key is the table name (modelName), value is field extensions.
 */
type SchemaExtensions = Record<string, TableExtension>;
/**
 * Default schema extensions for Better Auth plugins with incomplete schemas.
 *
 * These extensions are applied automatically by generateTableSchemas to ensure
 * proper GSI generation for efficient queries.
 */
declare const defaultSchemaExtensions: SchemaExtensions;

/**
 * @file Type definitions for table schema generation.
 */

/**
 * Composite index definition for DynamoDB GSI.
 */
type CompositeIndex = {
    /** Partition key field name */
    partitionKey: string;
    /** Sort key field name */
    sortKey: string;
};
/**
 * Options for generating table schemas from Better Auth configuration.
 */
type GenerateTableSchemasOptions = {
    /**
     * Additional composite indexes to create.
     * Key is table name, value is array of composite index definitions.
     */
    compositeIndexes?: Record<string, CompositeIndex[]>;
    /**
     * Disable auto-detection of composite indexes from Better Auth access patterns.
     * @default false
     */
    disableAutoCompositeIndexes?: boolean;
    /**
     * Automatically create GSI for fields with `references` (foreign keys).
     * This enables efficient Query-based joins instead of Scan fallback.
     * @default true
     */
    indexReferences?: boolean;
    /**
     * Disable default schema extensions for plugins with incomplete schemas.
     * @default false
     */
    disableSchemaExtensions?: boolean;
    /**
     * Additional schema extensions to apply.
     * Merged with default extensions (unless disableSchemaExtensions is true).
     */
    schemaExtensions?: SchemaExtensions;
};

/**
 * Generate DynamoDB TableSchema array from Better Auth options.
 *
 * This function uses Better Auth's `getAuthTables()` internally, which is the same
 * method used by `npx @better-auth/cli migrate`. This ensures schema compatibility
 * with Better Auth's expectations.
 *
 * @param options - Better Auth configuration options (same as betterAuth())
 * @param schemaOptions - Optional schema generation options
 * @returns Array of TableSchema for use with applyTableSchemas and createIndexResolversFromSchemas
 */
declare const generateTableSchemas: (options: BetterAuthOptions, schemaOptions?: GenerateTableSchemasOptions) => TableSchema[];
/**
 * Convert Better Auth database schema to DynamoDB TableSchema format.
 *
 * This is a lower-level function for when you already have a BetterAuthDBSchema.
 * Most users should use `generateTableSchemas()` instead.
 *
 * @param tables - Better Auth database schema
 * @param schemaOptions - Optional schema generation options
 * @returns Array of TableSchema
 */
declare const convertToTableSchemas: (tables: BetterAuthDBSchema, schemaOptions?: GenerateTableSchemasOptions) => TableSchema[];

/**
 * @file Index resolver utilities for DynamoDB adapter.
 *
 * Creates resolver functions that map field names to GSI names and key schemas.
 * These resolvers are used by the adapter to determine which GSI to query.
 */

/**
 * Create index resolver functions from table schemas.
 *
 * @param schemas - Array of TableSchema definitions
 * @returns IndexResolverBundle with indexNameResolver and indexKeySchemaResolver
 *
 * @example
 * ```typescript
 * const schemas = generateTableSchemas({ plugins: [twoFactor()] });
 * const resolvers = createIndexResolversFromSchemas(schemas);
 *
 * // Get GSI name for a field
 * const indexName = resolvers.indexNameResolver({ model: "user", field: "email" });
 * // => "user_email_idx"
 *
 * // Get key schema for a GSI
 * const keySchema = resolvers.indexKeySchemaResolver({
 *   model: "account",
 *   indexName: "account_providerId_accountId_idx"
 * });
 * // => { partitionKey: "providerId", sortKey: "accountId" }
 * ```
 */
declare const createIndexResolversFromSchemas: (schemas: TableSchema[]) => IndexResolverBundle;

/**
 * @file Default composite index definitions for DynamoDB GSIs.
 *
 * These composite indexes are derived from Better Auth's internal access patterns
 * (internal-adapter.mjs) to optimize query performance. They are applied by default
 * when generating table schemas.
 */

/**
 * Default composite indexes based on Better Auth's query patterns.
 *
 * These optimize common access patterns:
 * - account: lookup by providerId + accountId (OAuth linking)
 * - session: lookup by userId/token + createdAt (session management)
 * - verification: lookup by identifier + createdAt (verification codes)
 */
declare const defaultCompositeIndexes: Record<string, CompositeIndex[]>;

export { DynamoDBAdapterError, applyTableSchemas, convertToTableSchemas, coreTableSchemas, createIndexResolversFromSchemas, createTables, defaultCompositeIndexes, defaultSchemaExtensions, dynamodbAdapter, generateTableSchemas, multiTableSchemas };
export type { ApplyTableSchemasOptions, CompositeIndex, DynamoDBAdapterConfig, DynamoDBIndexKeySchema, DynamoDBTableNameResolver, FieldExtension, GenerateTableSchemasOptions, IndexMapping, IndexResolverBundle, SchemaExtensions, TableDefinition, TableExtension, TableSchema };
