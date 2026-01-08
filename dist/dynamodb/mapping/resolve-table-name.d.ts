import type { DynamoDBAdapterConfig } from "../../adapter";
export type DefaultModelNameResolver = (model: string) => string;
export declare const resolveTableName: (props: {
    model: string;
    getDefaultModelName: DefaultModelNameResolver;
    config: DynamoDBAdapterConfig;
}) => string;
//# sourceMappingURL=resolve-table-name.d.ts.map