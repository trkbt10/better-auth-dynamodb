/**
 * @file Client-side where filtering for adapter executor.
 */
import type { NormalizedWhere } from "../query-plan";
import { applyWhereFilters, type DynamoDBItem } from "./where-evaluator";

export const applyClientFilter = (props: {
	items: DynamoDBItem[];
	where?: NormalizedWhere[] | undefined;
	requiresClientFilter: boolean;
}): DynamoDBItem[] => {
	if (!props.requiresClientFilter) {
		return props.items;
	}
	return applyWhereFilters({ items: props.items, where: props.where });
};
