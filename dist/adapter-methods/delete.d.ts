/**
 * @file Delete method for the DynamoDB adapter.
 */
import type { Where } from "@better-auth/core/db/adapter";
import type { AdapterClientContainer } from "./client-container";
import type { DeleteMethodOptions } from "./delete-many";
export declare const createDeleteMethod: (client: AdapterClientContainer, options: DeleteMethodOptions) => ({ model, where, }: {
    model: string;
    where: Where[];
}) => Promise<void>;
//# sourceMappingURL=delete.d.ts.map