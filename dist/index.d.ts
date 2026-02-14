/**
 * @file Package entry point for DynamoDB adapter exports.
 */
export { dynamodbAdapter } from "./adapter";
export { DynamoDBAdapterError } from "./dynamodb/errors/errors";
export { applyTableSchemas, type ApplyTableSchemasOptions } from "./apply-table-schemas";
export { createTables } from "./create-tables";
export { coreTableSchemas, multiTableSchemas, // deprecated alias
generateTableSchemas, convertToTableSchemas, createIndexResolversFromSchemas, defaultCompositeIndexes, defaultSchemaExtensions, type CompositeIndex, type FieldExtension, type GenerateTableSchemasOptions, type SchemaExtensions, type TableExtension, } from "./table-schemas";
export type { DynamoDBAdapterConfig, DynamoDBTableNameResolver, } from "./adapter";
export type { DynamoDBIndexKeySchema, IndexMapping, IndexResolverBundle, TableDefinition, TableSchema, } from "./dynamodb/types";
//# sourceMappingURL=index.d.ts.map