/**
 * @file Find-many method for the DynamoDB adapter.
 */
import type { JoinConfig, Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import type { AdapterClientContainer } from "./client-container";
type FindManyInput = {
    model: string;
    where?: Where[] | undefined;
    limit: number;
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
};
export declare const createFindManyExecutor: (client: AdapterClientContainer, options: FindManyOptions) => ({ model, where, limit, sortBy, offset, join, }: FindManyInput) => Promise<import("../adapter/executor/where-evaluator").DynamoDBItem[]>;
export declare const createFindManyMethod: (client: AdapterClientContainer, options: FindManyOptions) => <T>(input: FindManyInput) => Promise<T[]>;
export {};
//# sourceMappingURL=find-many.d.ts.map