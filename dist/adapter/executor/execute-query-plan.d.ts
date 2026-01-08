/**
 * @file Execute adapter query plans.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBAdapterConfig } from "../../adapter";
import type { AdapterQueryPlan } from "../query-plan";
import type { DynamoDBItem } from "./where-evaluator";
export declare const createQueryPlanExecutor: (props: {
    documentClient: DynamoDBDocumentClient;
    adapterConfig: DynamoDBAdapterConfig;
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
    getDefaultModelName: (model: string) => string;
}) => (plan: AdapterQueryPlan) => Promise<DynamoDBItem[]>;
//# sourceMappingURL=execute-query-plan.d.ts.map