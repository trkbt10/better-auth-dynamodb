/**
 * @file Find-one method for the DynamoDB adapter.
 */
import type { JoinConfig, Where } from "@better-auth/core/db/adapter";
import type { FindManyOptions } from "./find-many";
import type { AdapterClientContainer } from "./client-container";
import type { PrimaryKeyBatchLoader } from "../adapter/batching/primary-key-batch-loader";
import type { DynamoDBTransactionState } from "../dynamodb/ops/transaction";
type FindOneOptions = FindManyOptions & {
    primaryKeyLoader?: PrimaryKeyBatchLoader | undefined;
    transactionState?: DynamoDBTransactionState | undefined;
};
export declare const createFindOneMethod: (client: AdapterClientContainer, options: FindOneOptions) => <T>({ model, where, select, join, }: {
    model: string;
    where: Where[];
    select?: string[] | undefined;
    join?: JoinConfig | undefined;
}) => Promise<T | null>;
export {};
//# sourceMappingURL=find-one.d.ts.map