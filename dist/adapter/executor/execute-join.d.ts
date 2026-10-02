/**
 * @file Execute join steps for adapter query plans.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBAdapterConfig } from "../../adapter";
import type { JoinPlan } from "../query-plan";
import type { DynamoDBItem } from "./where-evaluator";
import type { DynamoDBOperationStatsCollector } from "../../dynamodb/ops/operation-stats";
import { type DynamoDBTransactionState } from "../../dynamodb/ops/transaction";
export declare const executeJoin: (props: {
    baseItems: DynamoDBItem[];
    join: JoinPlan;
    documentClient: DynamoDBDocumentClient;
    adapterConfig: DynamoDBAdapterConfig;
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
    getDefaultModelName: (model: string) => string;
    operationStats?: DynamoDBOperationStatsCollector | undefined;
    transactionState?: DynamoDBTransactionState | undefined;
}) => Promise<DynamoDBItem[]>;
