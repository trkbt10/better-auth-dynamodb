import type { Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import { type DynamoDBTransactionState } from "../dynamodb/ops/transaction";
import type { AdapterClientContainer } from "./client-container";
type DeleteExecutionInput = {
    model: string;
    where: Where[];
    limit?: number | undefined;
};
export type DeleteMethodOptions = {
    adapterConfig: ResolvedDynamoDBAdapterConfig;
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
    getDefaultModelName: (model: string) => string;
    transactionState?: DynamoDBTransactionState | undefined;
};
export declare const createDeleteExecutor: (client: AdapterClientContainer, options: DeleteMethodOptions) => ({ model, where, limit }: DeleteExecutionInput) => Promise<number>;
export declare const createDeleteManyMethod: (client: AdapterClientContainer, options: DeleteMethodOptions) => ({ model, where }: {
    model: string;
    where: Where[];
}) => Promise<number>;
export {};
//# sourceMappingURL=delete-many.d.ts.map