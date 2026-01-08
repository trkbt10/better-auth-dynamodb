/**
 * @file Package entry point for DynamoDB adapter exports.
 */
export { dynamodbAdapter } from "./adapter";
export { DynamoDBAdapterError } from "./dynamodb/errors/errors";
export { createTables } from "./create-tables";
export { createIndexResolversFromSchemas, multiTableSchemas, } from "./table-schema";
export type { DynamoDBAdapterConfig, DynamoDBTableNameResolver, } from "./adapter";
export type { DynamoDBIndexKeySchema, IndexMapping, IndexResolverBundle, TableDefinition, TableSchema, } from "./dynamodb/types";
//# sourceMappingURL=index.d.ts.map