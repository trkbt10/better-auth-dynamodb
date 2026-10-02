/**
 * @file Condition expression builder for atomic single-row writes.
 *
 * consumeOne / incrementOne resolve their target row first and then issue a
 * keyed DeleteItem / UpdateItem. DynamoDB has to re-evaluate the where clause
 * in the same request as the write; otherwise a row that stopped matching
 * between the read and the write would still be consumed or mutated.
 */
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { DynamoDBWhere } from "../types";
export type AtomicCondition = {
    conditionExpression: string;
    expressionAttributeNames: Record<string, string>;
    expressionAttributeValues: Record<string, NativeAttributeValue>;
};
/**
 * A where clause can be lowered into a condition expression only when every
 * entry has a DynamoDB counterpart (ends_with and case-insensitive comparisons
 * do not).
 */
export declare const canEvaluateWhereOnServer: (where: DynamoDBWhere[]) => boolean;
/**
 * Build the condition guarding a keyed write.
 *
 * - The row must still exist (`attribute_exists` on the primary key).
 * - The where clause is lowered as-is when DynamoDB can evaluate it.
 * - Otherwise every field the where clause references is pinned to the value
 *   observed in the snapshot: an unchanged field keeps the client-side
 *   verdict valid, for any combination of AND / OR connectors.
 * - `pinnedFields` are pinned to the snapshot as well, for callers that hand
 *   the snapshot back as the result of the write.
 */
export declare const buildAtomicCondition: (props: {
    model: string;
    where: DynamoDBWhere[];
    primaryKeyName: string;
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
    snapshot?: Record<string, NativeAttributeValue> | undefined;
    pinnedFields?: string[] | undefined;
}) => AtomicCondition;
