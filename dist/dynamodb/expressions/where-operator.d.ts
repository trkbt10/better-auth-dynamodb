/**
 * @file Where-operator handlers for DynamoDB adapter.
 */
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
export type WhereOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "contains" | "starts_with" | "ends_with";
export type FilterExpressionContext = {
    fieldToken: string;
    value: unknown;
    appendValue: (value: NativeAttributeValue) => string;
};
export type EvaluationContext = {
    fieldValue: NativeAttributeValue | undefined;
    value: unknown;
};
type OperatorHandler = {
    requiresClientFilter: boolean;
    buildFilterExpression?: (ctx: FilterExpressionContext) => string;
    evaluate: (ctx: EvaluationContext) => boolean;
};
export declare const getOperatorHandler: (operator: string | undefined) => OperatorHandler;
export declare const isClientOnlyOperator: (operator: string | undefined) => boolean;
export declare const normalizeWhereOperator: (operator: string | undefined) => string;
/**
 * `mode: "insensitive"` only applies to string comparisons.
 */
export declare const isCaseInsensitiveComparison: (entry: {
    mode?: string | undefined;
    value: unknown;
}) => boolean;
/**
 * Whether a where entry has to be evaluated in memory: DynamoDB has neither
 * an ends_with function nor case-insensitive comparison.
 */
export declare const requiresClientEvaluation: (entry: {
    operator?: string | undefined;
    mode?: string | undefined;
    value: unknown;
}) => boolean;
/**
 * Whether the value of an equality (or IN) entry can be used as a key
 * condition. A key condition is an exact, case-sensitive match on a key
 * attribute, and a key attribute never holds null: a row whose field is null
 * is simply absent from the index.
 */
export declare const canServeAsKeyCondition: (entry: {
    mode?: string | undefined;
    value: unknown;
}) => boolean;
/**
 * Evaluate one where entry against an attribute value in memory.
 */
export declare const evaluateWhereEntry: (props: {
    operator: string | undefined;
    mode?: string | undefined;
    fieldValue: NativeAttributeValue | undefined;
    value: unknown;
}) => boolean;
export {};
//# sourceMappingURL=where-operator.d.ts.map