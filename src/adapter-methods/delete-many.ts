/**
 * @file Delete-many method for the DynamoDB adapter.
 */
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { Where } from "@better-auth/core/db/adapter";
import { buildPrimaryKey } from "../dynamodb/keys/primary-key";
import { addTransactionOperation } from "../dynamodb/operations/transaction";
import type { DynamoDBItem } from "../dynamodb/where/where-evaluator";
import type { AdapterMethodContext } from "./types";

export const createDeleteManyMethod = (context: AdapterMethodContext) => {
	const {
		documentClient,
		fetcher,
		mapWhereFilters,
		resolveModelTableName,
		getPrimaryKeyName,
		transactionState,
	} = context;

	return async ({
		model,
		where,
	}: {
		model: string;
		where: Where[];
	}) => {
		const tableName = resolveModelTableName(model);
		const result = await fetcher.fetchItems({
			model,
			where: mapWhereFilters(where),
		});

		const filteredItems = fetcher.applyClientFilter({
			items: result.items,
			where: mapWhereFilters(where),
			model,
			requiresClientFilter: result.requiresClientFilter,
		});

		if (filteredItems.length === 0) {
			return 0;
		}

		const primaryKeyName = getPrimaryKeyName(model);
		const state = { deleted: 0 };

		for (const item of filteredItems) {
			const key = buildPrimaryKey({
				item: item as DynamoDBItem,
				keyField: primaryKeyName,
			});
			if (transactionState) {
				addTransactionOperation(transactionState, {
					kind: "delete",
					tableName,
					key,
				});
			} else {
				await documentClient.send(
					new DeleteCommand({
						TableName: tableName,
						Key: key,
					}),
				);
			}
			state.deleted += 1;
		}

		return state.deleted;
	};
};
