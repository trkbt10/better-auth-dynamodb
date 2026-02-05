/**
 * @file Format adapter query plans for console debugging.
 */
import type { AdapterQueryPlan } from "../query-plan";
import type { ResolvedDynamoDBAdapterConfig } from "../../adapter";
export declare const formatAdapterQueryPlan: (props: {
    plan: AdapterQueryPlan;
    adapterConfig: ResolvedDynamoDBAdapterConfig;
    getDefaultModelName: (model: string) => string;
}) => string;
export declare const formatPrimaryKeyLookupPlan: (props: {
    model: string;
    tableName: string;
    keyField: string;
    key: unknown;
}) => string;
//# sourceMappingURL=format-query-plan.d.ts.map