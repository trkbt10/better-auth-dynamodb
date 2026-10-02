/**
 * @file Key condition builder for DynamoDB adapter.
 */
import type { DynamoDBIndexKeySchema, DynamoDBWhere } from "../types";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
export declare const buildKeyCondition: (props: {
    model: string;
    where: DynamoDBWhere[] | undefined;
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
    indexNameResolver: (args: {
        model: string;
        field: string;
    }) => string | undefined;
    indexKeySchemaResolver?: ((args: {
        model: string;
        indexName: string;
    }) => DynamoDBIndexKeySchema | undefined) | undefined;
}) => {
    keyConditionExpression: string;
    expressionAttributeNames: Record<string, string>;
    expressionAttributeValues: Record<string, NativeAttributeValue>;
    indexName?: string | undefined;
    remainingWhere: DynamoDBWhere[];
    /**
     * Key attributes of the table or index the query runs on. DynamoDB rejects
     * a FilterExpression that references any of them.
     */
    keyAttributes: string[];
} | null;
/**
 * Pick the where entries a Query may send as its FilterExpression.
 *
 * Entries on a key attribute of the queried table or index are left out,
 * because DynamoDB rejects them there; the caller evaluates the full where
 * clause in memory afterwards. What remains is still a necessary condition:
 * a subset of the AND group, plus the OR group only when it is complete.
 */
export declare const selectQueryFilterWhere: (props: {
    model: string;
    where: DynamoDBWhere[];
    keyAttributes: string[];
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
}) => DynamoDBWhere[];
/**
 * Whether a Query for this where clause leaves entries on key attributes that
 * cannot go into its FilterExpression.
 */
export declare const hasKeyAttributeFilter: (props: {
    model: string;
    where: DynamoDBWhere[];
    keyAttributes: string[];
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
}) => boolean;
