/**
 * @file Index resolver utilities for DynamoDB adapter.
 *
 * Creates resolver functions that map field names to GSI names and key schemas.
 * These resolvers are used by the adapter to determine which GSI to query.
 */
import type { IndexMapping, IndexResolverBundle, TableSchema } from "../dynamodb/types";

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
export const createIndexResolversFromSchemas = (
	schemas: TableSchema[],
): IndexResolverBundle => {
	if (schemas.length === 0) {
		throw new Error("index resolver creation requires table schemas.");
	}
	const partitionIndexMap = new Map<string, IndexMapping>();
	const indexNameMap = new Map<string, IndexMapping>();
	for (const schema of schemas) {
		for (const mapping of schema.indexMappings) {
			const partitionKey = `${schema.tableName}:${mapping.partitionKey}`;
			if (partitionIndexMap.has(partitionKey)) {
				throw new Error(
					`Duplicate partition key mapping for ${schema.tableName}.${mapping.partitionKey}.`,
				);
			}
			partitionIndexMap.set(partitionKey, mapping);

			const indexKey = `${schema.tableName}:${mapping.indexName}`;
			if (indexNameMap.has(indexKey)) {
				throw new Error(
					`Duplicate index name mapping for ${schema.tableName}.${mapping.indexName}.`,
				);
			}
			indexNameMap.set(indexKey, mapping);
		}
	}

	return {
		indexNameResolver: ({ model, field }) =>
			partitionIndexMap.get(`${model}:${field}`)?.indexName,
		indexKeySchemaResolver: ({ model, indexName }) => {
			const mapping = indexNameMap.get(`${model}:${indexName}`);
			if (!mapping) {
				return undefined;
			}
			return {
				partitionKey: mapping.partitionKey,
				sortKey: mapping.sortKey,
			};
		},
	};
};
