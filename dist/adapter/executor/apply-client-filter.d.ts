/**
 * @file Client-side where filtering for adapter executor.
 */
import type { NormalizedWhere } from "../query-plan";
import { type DynamoDBItem } from "./where-evaluator";
export declare const applyClientFilter: (props: {
    items: DynamoDBItem[];
    where?: NormalizedWhere[] | undefined;
    requiresClientFilter: boolean;
}) => DynamoDBItem[];
//# sourceMappingURL=apply-client-filter.d.ts.map