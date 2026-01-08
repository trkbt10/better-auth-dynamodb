/**
 * @file Resolve join plan entries for adapter query plans.
 */
import type { JoinConfig } from "@better-auth/core/db/adapter";
import type { JoinPlan } from "../query-plan";
import type { DynamoDBAdapterConfig } from "../../adapter";
export declare const resolveJoinPlan: (props: {
    join?: JoinConfig | undefined;
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
    adapterConfig: Pick<DynamoDBAdapterConfig, "indexNameResolver">;
}) => JoinPlan[];
//# sourceMappingURL=resolve-join-plan.d.ts.map