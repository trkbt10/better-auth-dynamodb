/**
 * @file Find-many method for the DynamoDB adapter.
 */
import type { JoinConfig, Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import type { AdapterClientContainer } from "./client-container";
import type { DynamoDBTransactionState } from "../dynamodb/ops/transaction";
type FindManyInput = {
    model: string;
    where?: Where[] | undefined;
    limit: number;
    select?: string[] | undefined;
    sortBy?: {
        field: string;
        direction: "asc" | "desc";
    } | undefined;
    offset?: number | undefined;
    join?: JoinConfig | undefined;
};
export type FindManyOptions = {
    adapterConfig: ResolvedDynamoDBAdapterConfig;
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
    getDefaultModelName: (model: string) => string;
    transactionState?: DynamoDBTransactionState | undefined;
};
export declare const createFindManyExecutor: (client: AdapterClientContainer, options: FindManyOptions) => ({ model, where, limit, select, sortBy, offset, join, }: FindManyInput) => Promise<import("../adapter/executor/where-evaluator").DynamoDBItem[]>;
export declare const createFindManyMethod: (client: AdapterClientContainer, options: FindManyOptions) => <T>(input: FindManyInput) => Promise<T[]>;
export {};
