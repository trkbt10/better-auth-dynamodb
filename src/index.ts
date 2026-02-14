/**
 * @file Package entry point for DynamoDB adapter exports.
 */
export { dynamodbAdapter } from "./adapter";
export { DynamoDBAdapterError } from "./dynamodb/errors/errors";
export { applyTableSchemas, type ApplyTableSchemasOptions } from "./apply-table-schemas";
export { createTables } from "./create-tables";

// Table schemas (reorganized)
export {
	// Core schemas (hand-crafted)
	coreTableSchemas,
	multiTableSchemas, // deprecated alias
	// Schema generation from Better Auth
	generateTableSchemas,
	convertToTableSchemas,
	// Index resolvers
	createIndexResolversFromSchemas,
	// Composite indexes
	defaultCompositeIndexes,
	// Schema extensions
	defaultSchemaExtensions,
	// Types
	type CompositeIndex,
	type FieldExtension,
	type GenerateTableSchemasOptions,
	type SchemaExtensions,
	type TableExtension,
} from "./table-schemas";

export type {
	DynamoDBAdapterConfig,
	DynamoDBTableNameResolver,
} from "./adapter";
export type {
	DynamoDBIndexKeySchema,
	IndexMapping,
	IndexResolverBundle,
	TableDefinition,
	TableSchema,
} from "./dynamodb/types";
