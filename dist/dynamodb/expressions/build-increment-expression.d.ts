/**
 * @file Update expression builder for atomic counter mutations (incrementOne).
 *
 * Counters are advanced with `field = field + delta` arithmetic evaluated by
 * DynamoDB, so concurrent increments cannot lose updates. Better Auth treats a
 * counter that is null or absent as 0; DynamoDB arithmetic accepts a missing
 * attribute (through `if_not_exists`) but rejects a NULL-typed one, so the
 * expression is chosen from the row snapshot and guarded by the attribute
 * type it was chosen for.
 */
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
export type IncrementAssignments = {
    increment: Record<string, number>;
    set: Record<string, NativeAttributeValue>;
    /**
     * Attributes to remove: index key attributes that are set to null, which
     * DynamoDB cannot store in them.
     */
    remove: string[];
};
export type IncrementExpression = {
    updateExpression: string;
    /**
     * Conditions on the attribute type of each counter. They must hold for the
     * update expression to be the right one for the stored value.
     */
    counterConditions: string[];
    expressionAttributeNames: Record<string, string>;
    expressionAttributeValues: Record<string, NativeAttributeValue>;
    /**
     * The snapshot with the mutation applied.
     */
    nextItem: Record<string, NativeAttributeValue>;
};
/**
 * Normalize the incrementOne payload: drop unassigned (`undefined`) set
 * values, and reject payloads DynamoDB cannot apply in one expression.
 */
export declare const resolveIncrementAssignments: (props: {
    increment: Record<string, number>;
    set?: Record<string, unknown> | undefined;
    indexKeyAttributes?: string[] | undefined;
}) => IncrementAssignments;
export declare const hasIncrementAssignments: (assignments: IncrementAssignments) => boolean;
export declare const buildIncrementExpression: (props: {
    snapshot: Record<string, NativeAttributeValue>;
    assignments: IncrementAssignments;
}) => IncrementExpression;
//# sourceMappingURL=build-increment-expression.d.ts.map