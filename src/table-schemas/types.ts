/**
 * @file Type definitions for table schema generation.
 */

import type { SchemaExtensions } from "./schema-extensions";

/**
 * Composite index definition for DynamoDB GSI.
 */
export type CompositeIndex = {
	/** Partition key field name */
	partitionKey: string;
	/** Sort key field name */
	sortKey: string;
};

/**
 * Options for generating table schemas from Better Auth configuration.
 */
export type GenerateTableSchemasOptions = {
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
