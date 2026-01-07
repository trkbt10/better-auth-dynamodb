/**
 * @file Find-one method for the DynamoDB adapter.
 */
import type { JoinConfig, Where } from "@better-auth/core/db/adapter";
import { DynamoDBAdapterError } from "../dynamodb/errors/errors";
import type { AdapterMethodContext } from "./types";

export const createFindOneMethod = (context: AdapterMethodContext) => {
	const { fetcher, mapWhereFilters, getFieldName } = context;

	return async <T>({
		model,
		where,
		select,
		join,
	}: {
		model: string;
		where: Where[];
		select?: string[] | undefined;
		join?: JoinConfig | undefined;
	}) => {
		if (join) {
			throw new DynamoDBAdapterError(
				"UNSUPPORTED_JOIN",
				"DynamoDB adapter does not support joins.",
			);
		}

		const fetchResult = await fetcher.fetchItems({
			model,
			where: mapWhereFilters(where),
			limit: 1,
		});
		const filteredItems = fetcher.applyClientFilter({
			items: fetchResult.items,
			where: mapWhereFilters(where),
			model,
			requiresClientFilter: fetchResult.requiresClientFilter,
		});

		if (filteredItems.length === 0) {
			return null;
		}

		const item = filteredItems[0] as T;
		if (!select || select.length === 0) {
			return item;
		}

		const selection: Record<string, unknown> = {};
		select.forEach((field) => {
			const resolvedField = getFieldName({ model, field });
			if (resolvedField in (item as Record<string, unknown>)) {
				selection[resolvedField] = (item as Record<string, unknown>)[
					resolvedField
				];
			}
		});

		return selection as T;
	};
};
