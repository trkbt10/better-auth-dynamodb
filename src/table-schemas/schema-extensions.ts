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
export type FieldExtension = {
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
export type TableExtension = Record<string, FieldExtension>;

/**
 * Schema extensions for all tables.
 * Key is the table name (modelName), value is field extensions.
 */
export type SchemaExtensions = Record<string, TableExtension>;

/**
 * Default schema extensions for Better Auth plugins with incomplete schemas.
 *
 * These extensions are applied automatically by generateTableSchemas to ensure
 * proper GSI generation for efficient queries.
 */
export const defaultSchemaExtensions: SchemaExtensions = {
	/**
	 * deviceCode table from deviceAuthorization plugin.
	 *
	 * The plugin schema does not include references/index for userId despite
	 * documentation stating it references the user table.
	 *
	 * @see https://www.better-auth.com/docs/plugins/device-authorization
	 */
	deviceCode: {
		userId: {
			index: true,
			references: { model: "user", field: "id" },
		},
	},
};
