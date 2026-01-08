/**
 * @file Count method for the DynamoDB adapter.
 */
import type { Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import type { AdapterClientContainer } from "./client-container";
export type CountMethodOptions = {
    adapterConfig: ResolvedDynamoDBAdapterConfig;
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
    getDefaultModelName: (model: string) => string;
};
export declare const createCountMethod: (client: AdapterClientContainer, options: CountMethodOptions) => ({ model, where, }: {
    model: string;
    where?: Where[] | undefined;
}) => Promise<number>;
//# sourceMappingURL=count.d.ts.map