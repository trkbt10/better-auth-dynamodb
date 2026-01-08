/**
 * @file Find-one method for the DynamoDB adapter.
 */
import type { JoinConfig, Where } from "@better-auth/core/db/adapter";
import type { FindManyOptions } from "./find-many";
import type { AdapterClientContainer } from "./client-container";
type FindOneOptions = FindManyOptions;
export declare const createFindOneMethod: (client: AdapterClientContainer, options: FindOneOptions) => <T>({ model, where, select, join, }: {
    model: string;
    where: Where[];
    select?: string[] | undefined;
    join?: JoinConfig | undefined;
}) => Promise<T | null>;
export {};
//# sourceMappingURL=find-one.d.ts.map