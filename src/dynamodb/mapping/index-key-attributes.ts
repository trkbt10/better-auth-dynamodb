/**
 * @file Null handling for attributes that are keys of a global secondary index.
 *
 * DynamoDB rejects a write that stores NULL in an attribute an index uses as
 * its partition or sort key ("Type mismatch for Index Key"). A null value of
 * such a field is therefore written as a missing attribute, which simply keeps
 * the row out of that index, and read back as null.
 */
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { BetterAuthDBSchema } from "@better-auth/core/db";
import type { DynamoDBIndexKeySchema } from "../types";

type Row = Record<string, NativeAttributeValue>;

/**
 * Create the lookup of the index key attributes of a model: every field the
 * index resolvers know as a partition key, plus the sort key of its index.
 */
export const createIndexKeyAttributeResolver = (props: {
	schema: BetterAuthDBSchema;
	getDefaultModelName: (model: string) => string;
	indexNameResolver: (args: { model: string; field: string }) => string | undefined;
	indexKeySchemaResolver?:
		| ((args: { model: string; indexName: string }) => DynamoDBIndexKeySchema | undefined)
		| undefined;
}): ((model: string) => string[]) => {
	const cache = new Map<string, string[]>();

	const resolve = (model: string): string[] => {
		const fields = props.schema[props.getDefaultModelName(model)]?.fields ?? {};
		const attributes = Object.entries(fields).flatMap(([fieldKey, field]) => {
			const attribute = field.fieldName ?? fieldKey;
			const indexName = props.indexNameResolver({ model, field: attribute });
			if (!indexName) {
				return [];
			}
			const sortKey = props.indexKeySchemaResolver?.({ model, indexName })?.sortKey;
			if (!sortKey) {
				return [attribute];
			}
			return [attribute, sortKey];
		});
		return Array.from(new Set(attributes));
	};

	return (model) => {
		const cached = cache.get(model);
		if (cached) {
			return cached;
		}
		const resolved = resolve(model);
		cache.set(model, resolved);
		return resolved;
	};
};

/**
 * Drop the index key attributes whose value is null, so they can be written.
 */
export const omitNullIndexKeys = <T extends Record<string, unknown>>(
	row: T,
	indexKeyAttributes: string[],
): T => {
	if (!indexKeyAttributes.some((attribute) => row[attribute] === null)) {
		return row;
	}
	const entries = Object.entries(row).filter(([attribute, value]) => {
		if (value !== null) {
			return true;
		}
		return !indexKeyAttributes.includes(attribute);
	});
	return Object.fromEntries(entries) as T;
};

/**
 * Report missing index key attributes as null, the value they stand for.
 * `only` limits the attributes to the ones a projection asked for.
 */
export const restoreNullIndexKeys = (
	row: Row,
	indexKeyAttributes: string[],
	only?: string[] | undefined,
): Row => {
	const missing = indexKeyAttributes.filter((attribute) => {
		if (row[attribute] !== undefined) {
			return false;
		}
		if (!only) {
			return true;
		}
		return only.includes(attribute);
	});
	if (missing.length === 0) {
		return row;
	}
	return missing.reduce<Row>(
		(acc, attribute) => ({ ...acc, [attribute]: null }),
		{ ...row },
	);
};
