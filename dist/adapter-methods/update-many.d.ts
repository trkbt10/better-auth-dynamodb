import type { Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import { type DynamoDBTransactionState } from "../dynamodb/ops/transaction";
import type { AdapterClientContainer } from "./client-container";
type UpdateExecutionInput = {
    model: string;
    where: Where[];
    update: Record<string, unknown>;
    limit?: number | undefined;
    returnUpdatedItems: boolean;
};
type UpdateExecutionResult = {
    updatedCount: number;
    updatedItems: Record<string, unknown>[];
};
export type UpdateMethodOptions = {
    adapterConfig: ResolvedDynamoDBAdapterConfig;
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
    getDefaultModelName: (model: string) => string;
    transactionState?: DynamoDBTransactionState | undefined;
};
export declare const createUpdateExecutor: (client: AdapterClientContainer, options: UpdateMethodOptions) => ({ model, where, update, limit, returnUpdatedItems, }: UpdateExecutionInput) => Promise<UpdateExecutionResult>;
export declare const createUpdateManyMethod: (client: AdapterClientContainer, options: UpdateMethodOptions) => ({ model, where, update, }: {
    model: string;
    where: Where[];
    update: Record<string, unknown>;
}) => Promise<number>;
export {};
//# sourceMappingURL=update-many.d.ts.map