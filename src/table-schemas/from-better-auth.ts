/**
 * @file Generate DynamoDB table schemas from Better Auth configuration.
 *
 * This module converts Better Auth's schema definitions (obtained via getAuthTables)
 * into DynamoDB TableSchema format. Use this when:
 *
 * - You're using Better Auth plugins that add tables (twoFactor, organization, etc.)
 * - You want schemas that match your Better Auth configuration exactly
 * - You need automatic GSI generation based on unique/indexed fields
 *
 * For manual control over core tables without plugins, use `coreTableSchemas` instead.
 *
 * @example
 * ```typescript
 * import { betterAuth } from "better-auth";
 * import { twoFactor, organization } from "better-auth/plugins";
 * import { generateTableSchemas, createIndexResolversFromSchemas } from "better-auth-dynamodb";
 *
 * // Generate schemas matching your Better Auth config
 * const schemas = generateTableSchemas({
 *   plugins: [twoFactor(), organization()],
 * });
 *
 * // Create resolvers for the adapter
 * const resolvers = createIndexResolversFromSchemas(schemas);
 *
 * // Apply schemas to DynamoDB
 * await applyTableSchemas({ client, tables: schemas });
 * ```
 */
import type {
	AttributeDefinition,
	GlobalSecondaryIndex,
	KeySchemaElement,
} from "@aws-sdk/client-dynamodb";
import type { BetterAuthOptions } from "@better-auth/core";
import type { BetterAuthDBSchema } from "@better-auth/core/db";
import { getAuthTables } from "@better-auth/core/db";
import type { IndexMapping, TableSchema } from "../dynamodb/types";
import { defaultCompositeIndexes } from "./composite-indexes";
import { defaultSchemaExtensions, type SchemaExtensions } from "./schema-extensions";
import type { CompositeIndex, GenerateTableSchemasOptions } from "./types";

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
export const generateTableSchemas = (
	options: BetterAuthOptions,
	schemaOptions?: GenerateTableSchemasOptions,
): TableSchema[] => {
	const tables = getAuthTables(options);
	return convertToTableSchemas(tables, schemaOptions);
};

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
export const convertToTableSchemas = (
	tables: BetterAuthDBSchema,
	schemaOptions?: GenerateTableSchemasOptions,
): TableSchema[] => {
	const schemas: TableSchema[] = [];

	const compositeIndexes: Record<string, CompositeIndex[]> = mergeCompositeIndexes(
		schemaOptions?.disableAutoCompositeIndexes ? {} : defaultCompositeIndexes,
		schemaOptions?.compositeIndexes ?? {},
	);

	// Merge schema extensions
	const schemaExtensions: SchemaExtensions = mergeSchemaExtensions(
		schemaOptions?.disableSchemaExtensions ? {} : defaultSchemaExtensions,
		schemaOptions?.schemaExtensions ?? {},
	);

	for (const [tableName, tableSchema] of Object.entries(tables)) {
		const modelName = tableSchema.modelName ?? tableName;
		const indexMappings: IndexMapping[] = [];
		const attributeDefinitions: AttributeDefinition[] = [
			{ AttributeName: "id", AttributeType: "S" },
		];
		const globalSecondaryIndexes: GlobalSecondaryIndex[] = [];

		const definedAttributes = new Set<string>(["id"]);
		const definedIndexNames = new Set<string>();

		const ensureAttribute = (fieldName: string): void => {
			if (!definedAttributes.has(fieldName)) {
				attributeDefinitions.push({
					AttributeName: fieldName,
					AttributeType: "S",
				});
				definedAttributes.add(fieldName);
			}
		};

		// Process composite indexes first (they take precedence)
		const tableCompositeIndexes = compositeIndexes[modelName] ?? [];
		const compositePartitionKeys = new Set<string>();

		for (const composite of tableCompositeIndexes) {
			const pk = composite.partitionKey;
			const sk = composite.sortKey;
			const indexName = `${modelName}_${pk}_${sk}_idx`;

			if (definedIndexNames.has(indexName)) {
				continue;
			}

			ensureAttribute(pk);
			ensureAttribute(sk);

			globalSecondaryIndexes.push({
				IndexName: indexName,
				KeySchema: [
					{ AttributeName: pk, KeyType: "HASH" },
					{ AttributeName: sk, KeyType: "RANGE" },
				] as KeySchemaElement[],
				Projection: { ProjectionType: "ALL" },
			});

			indexMappings.push({
				indexName,
				partitionKey: pk,
				sortKey: sk,
			});

			definedIndexNames.add(indexName);
			compositePartitionKeys.add(pk);
		}

		// Process single-field indexes (skip if already part of composite with same PK)
		const indexReferences = schemaOptions?.indexReferences !== false;
		const tableExtensions = schemaExtensions[modelName] ?? {};

		for (const [fieldName, field] of Object.entries(tableSchema.fields)) {
			const dbFieldName = field.fieldName ?? fieldName;

			// Apply schema extensions if available
			const ext = tableExtensions[fieldName];
			const fieldIndex = ext?.index === true ? true : field.index === true;
			const fieldUnique = ext?.unique === true ? true : field.unique === true;
			const fieldReferences = ext?.references ?? field.references;

			const hasExplicitIndex = fieldIndex ? true : fieldUnique;
			const hasReference = fieldReferences !== undefined;
			const createForReference = hasReference ? indexReferences : false;
			const shouldCreateGsi = hasExplicitIndex ? true : createForReference;

			if (shouldCreateGsi) {
				if (compositePartitionKeys.has(dbFieldName)) {
					continue;
				}

				const indexName = `${modelName}_${dbFieldName}_idx`;
				if (definedIndexNames.has(indexName)) {
					continue;
				}

				ensureAttribute(dbFieldName);

				globalSecondaryIndexes.push({
					IndexName: indexName,
					KeySchema: [{ AttributeName: dbFieldName, KeyType: "HASH" }] as KeySchemaElement[],
					Projection: { ProjectionType: "ALL" },
				});

				indexMappings.push({
					indexName,
					partitionKey: dbFieldName,
				});

				definedIndexNames.add(indexName);
			}
		}

		schemas.push({
			tableName: modelName,
			tableDefinition: {
				attributeDefinitions,
				keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
				billingMode: "PAY_PER_REQUEST",
				globalSecondaryIndexes:
					globalSecondaryIndexes.length > 0 ? globalSecondaryIndexes : undefined,
			},
			indexMappings,
		});
	}

	return schemas;
};

/**
 * Deep merge composite indexes per table.
 * User-provided indexes are appended to defaults for each table.
 */
const mergeCompositeIndexes = (
	defaults: Record<string, CompositeIndex[]>,
	userIndexes: Record<string, CompositeIndex[]>,
): Record<string, CompositeIndex[]> => {
	const result: Record<string, CompositeIndex[]> = { ...defaults };

	for (const [tableName, indexes] of Object.entries(userIndexes)) {
		if (result[tableName]) {
			result[tableName] = [...result[tableName], ...indexes];
		} else {
			result[tableName] = indexes;
		}
	}

	return result;
};

/**
 * Deep merge schema extensions per table and per field.
 * User-provided extensions are merged into defaults at both table and field level.
 */
const mergeSchemaExtensions = (
	defaults: SchemaExtensions,
	userExtensions: SchemaExtensions,
): SchemaExtensions => {
	const result: SchemaExtensions = {};

	// Copy defaults with deep clone of field extensions
	for (const [tableName, tableExt] of Object.entries(defaults)) {
		result[tableName] = { ...tableExt };
	}

	// Merge user extensions
	for (const [tableName, tableExt] of Object.entries(userExtensions)) {
		if (result[tableName]) {
			// Deep merge fields within the table
			for (const [fieldName, fieldExt] of Object.entries(tableExt)) {
				result[tableName][fieldName] = {
					...result[tableName][fieldName],
					...fieldExt,
				};
			}
		} else {
			result[tableName] = { ...tableExt };
		}
	}

	return result;
};
