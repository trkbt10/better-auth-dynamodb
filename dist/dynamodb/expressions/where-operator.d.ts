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
export {};
//# sourceMappingURL=where-operator.d.ts.map