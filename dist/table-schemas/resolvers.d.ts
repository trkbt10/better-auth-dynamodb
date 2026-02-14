/**
 * @file Index resolver utilities for DynamoDB adapter.
 *
 * Creates resolver functions that map field names to GSI names and key schemas.
 * These resolvers are used by the adapter to determine which GSI to query.
 */
import type { IndexResolverBundle, TableSchema } from "../dynamodb/types";
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
export declare const createIndexResolversFromSchemas: (schemas: TableSchema[]) => IndexResolverBundle;
//# sourceMappingURL=resolvers.d.ts.map