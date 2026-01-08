/**
 * @file In-memory where clause evaluation for adapter executor.
 */
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { NormalizedWhere } from "../query-plan";
export type DynamoDBItem = Record<string, NativeAttributeValue>;
export declare const applyWhereFilters: (props: {
    items: DynamoDBItem[];
    where?: NormalizedWhere[] | undefined;
}) => DynamoDBItem[];
//# sourceMappingURL=where-evaluator.d.ts.map