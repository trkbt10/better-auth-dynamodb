/**
 * @file Execute adapter query plans.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBAdapterConfig } from "../../adapter";
import type { AdapterQueryPlan } from "../query-plan";
import type { DynamoDBItem } from "./where-evaluator";
import type { DynamoDBOperationStatsCollector } from "../../dynamodb/ops/operation-stats";
import { type DynamoDBTransactionState } from "../../dynamodb/ops/transaction";
export type AdapterExecutionContext = {
    operationStats?: DynamoDBOperationStatsCollector | undefined;
};
export declare const createQueryPlanExecutor: (props: {
    documentClient: DynamoDBDocumentClient;
    adapterConfig: DynamoDBAdapterConfig;
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
    getDefaultModelName: (model: string) => string;
    transactionState?: DynamoDBTransactionState | undefined;
}) => (requestedPlan: AdapterQueryPlan, context?: AdapterExecutionContext | undefined) => Promise<DynamoDBItem[]>;
//# sourceMappingURL=execute-query-plan.d.ts.map