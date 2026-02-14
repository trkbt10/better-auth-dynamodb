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

// Core table schemas (hand-crafted, no plugin support)
export { coreTableSchemas, multiTableSchemas } from "./core-schemas";

// Schema generation from Better Auth config (plugin support)
export { convertToTableSchemas, generateTableSchemas } from "./from-better-auth";

// Index resolvers
export { createIndexResolversFromSchemas } from "./resolvers";

// Composite index defaults
export { defaultCompositeIndexes } from "./composite-indexes";

// Schema extensions
export { defaultSchemaExtensions } from "./schema-extensions";

// Types
export type { CompositeIndex, GenerateTableSchemasOptions } from "./types";
export type { FieldExtension, SchemaExtensions, TableExtension } from "./schema-extensions";
