/**
 * @file Client-side filter application for DynamoDB fetcher.
 */
import type { DynamoDBWhere } from "../types";
import { applyWhereFilters, type DynamoDBItem } from "./where-evaluator";

export const applyClientFilter = (props: {
	items: DynamoDBItem[];
	where: DynamoDBWhere[] | undefined;
	model: string;
	getFieldName: (args: { model: string; field: string }) => string;
	requiresClientFilter: boolean;
}): DynamoDBItem[] => {
	if (!props.requiresClientFilter) {
		return props.items;
	}
	return applyWhereFilters({
		items: props.items,
		where: props.where,
		model: props.model,
		getFieldName: props.getFieldName,
	});
};
