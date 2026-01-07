/**
 * @file Count method for the DynamoDB adapter.
 */
import type { Where } from "@better-auth/core/db/adapter";
import type { AdapterMethodContext } from "./types";

export const createCountMethod = (context: AdapterMethodContext) => {
	const { fetchCount, applyClientFilter, mapWhereFilters } = context;

	return async ({
		model,
		where,
	}: {
		model: string;
		where?: Where[] | undefined;
	}) => {
		const result = await fetchCount({
			model,
			where: mapWhereFilters(where) ?? [],
		});
		if (!result.requiresClientFilter) {
			return result.count;
		}
		const filteredItems = applyClientFilter({
			items: result.items,
			where: mapWhereFilters(where),
			model,
			requiresClientFilter: true,
		});
		return filteredItems.length;
	};
};
