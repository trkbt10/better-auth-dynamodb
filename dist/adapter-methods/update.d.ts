/**
 * @file Update method for the DynamoDB adapter.
 */
import type { Where } from "@better-auth/core/db/adapter";
import type { AdapterClientContainer } from "./client-container";
import type { UpdateMethodOptions } from "./update-many";
export declare const createUpdateMethod: (client: AdapterClientContainer, options: UpdateMethodOptions) => <T>({ model, where, update, }: {
    model: string;
    where: Where[];
    update: T;
}) => Promise<T | null>;
//# sourceMappingURL=update.d.ts.map