/**
 * @file Table schema exports for DynamoDB adapter.
 *
 * This module provides table schema definitions and utilities for the Better Auth
 * DynamoDB adapter. There are two approaches to table schemas:
 *
 * ## 1. Core Table Schemas (Manual)
 * Use `coreTableSchemas` for explicit control over the core four tables
 * (user, session, account, verification) without plugin support:
 *
 * ```typescript
 * import { coreTableSchemas, createIndexResolversFromSchemas } from "better-auth-dynamodb";
 *
 * const resolvers = createIndexResolversFromSchemas(coreTableSchemas);
 * await applyTableSchemas({ client, tables: coreTableSchemas });
 * ```
 *
 * ## 2. Generated Schemas (Plugin Support)
 * Use `generateTableSchemas()` for automatic schema generation that matches
 * your Better Auth configuration including plugins:
 *
 * ```typescript
 * import { generateTableSchemas, createIndexResolversFromSchemas } from "better-auth-dynamodb";
 * import { twoFactor, organization } from "better-auth/plugins";
 *
 * const schemas = generateTableSchemas({
 *   plugins: [twoFactor(), organization()],
 * });
 * const resolvers = createIndexResolversFromSchemas(schemas);
 * await applyTableSchemas({ client, tables: schemas });
 * ```
 */
export { coreTableSchemas, multiTableSchemas } from "./core-schemas";
export { convertToTableSchemas, generateTableSchemas } from "./from-better-auth";
export { createIndexResolversFromSchemas } from "./resolvers";
export { defaultCompositeIndexes } from "./composite-indexes";
export { defaultSchemaExtensions } from "./schema-extensions";
export type { CompositeIndex, GenerateTableSchemasOptions } from "./types";
export type { FieldExtension, SchemaExtensions, TableExtension } from "./schema-extensions";
//# sourceMappingURL=index.d.ts.map