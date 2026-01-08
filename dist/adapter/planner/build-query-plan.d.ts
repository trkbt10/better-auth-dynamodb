/**
 * @file Build adapter query plan from Better Auth inputs.
 */
import type { JoinConfig, Where } from "@better-auth/core/db/adapter";
import type { DynamoDBAdapterConfig } from "../../adapter";
import type { AdapterQueryPlan } from "../query-plan";
export declare const buildQueryPlan: (props: {
    model: string;
    where?: Where[] | undefined;
    select?: string[] | undefined;
    sortBy?: {
        field: string;
        direction: "asc" | "desc";
    } | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
    join?: JoinConfig | undefined;
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
    adapterConfig: Pick<DynamoDBAdapterConfig, "indexNameResolver" | "indexKeySchemaResolver">;
}) => AdapterQueryPlan;
//# sourceMappingURL=build-query-plan.d.ts.map