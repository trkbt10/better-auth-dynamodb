/**
 * @file Resolve execution strategies for adapter query plans.
 */
import type { NormalizedWhere, ExecutionStrategy } from "../query-plan";
import type { DynamoDBAdapterConfig } from "../../adapter";
export declare const resolveBaseStrategy: (props: {
    model: string;
    where: NormalizedWhere[];
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
    adapterConfig: Pick<DynamoDBAdapterConfig, "indexNameResolver" | "indexKeySchemaResolver">;
}) => ExecutionStrategy;
export declare const resolveJoinStrategyHint: (props: {
    joinField: string;
    model: string;
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
    adapterConfig: Pick<DynamoDBAdapterConfig, "indexNameResolver">;
}) => ExecutionStrategy;
export declare const resolveJoinStrategy: (props: {
    joinField: string;
    model: string;
    baseValues: unknown[];
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
    adapterConfig: Pick<DynamoDBAdapterConfig, "indexNameResolver">;
}) => ExecutionStrategy;
//# sourceMappingURL=resolve-strategy.d.ts.map