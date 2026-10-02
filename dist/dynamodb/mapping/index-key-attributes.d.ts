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
export declare const createIndexKeyAttributeResolver: (props: {
    schema: BetterAuthDBSchema;
    getDefaultModelName: (model: string) => string;
    indexNameResolver: (args: {
        model: string;
        field: string;
    }) => string | undefined;
    indexKeySchemaResolver?: ((args: {
        model: string;
        indexName: string;
    }) => DynamoDBIndexKeySchema | undefined) | undefined;
}) => ((model: string) => string[]);
/**
 * Drop the index key attributes whose value is null, so they can be written.
 */
export declare const omitNullIndexKeys: <T extends Record<string, unknown>>(row: T, indexKeyAttributes: string[]) => T;
/**
 * Report missing index key attributes as null, the value they stand for.
 * `only` limits the attributes to the ones a projection asked for.
 */
export declare const restoreNullIndexKeys: (row: Row, indexKeyAttributes: string[], only?: string[] | undefined) => Row;
export {};
//# sourceMappingURL=index-key-attributes.d.ts.map