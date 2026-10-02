import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import type { AdapterClientContainer } from "./client-container";
import { type DynamoDBTransactionState } from "../dynamodb/ops/transaction";
export type CreateMethodOptions = {
    adapterConfig: ResolvedDynamoDBAdapterConfig;
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
    getDefaultModelName: (model: string) => string;
    transactionState?: DynamoDBTransactionState | undefined;
};
export declare const createCreateMethod: (client: AdapterClientContainer, options: CreateMethodOptions) => <T extends Record<string, unknown>>({ model, data, }: {
    model: string;
    data: T;
}) => Promise<T>;
