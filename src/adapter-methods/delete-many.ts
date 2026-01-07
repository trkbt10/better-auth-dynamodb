/**
 * @file Delete-many method for the DynamoDB adapter.
 */
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { Where } from "@better-auth/core/db/adapter";
import { buildPrimaryKey } from "../dynamodb/query-utils/build-primary-key";
import { addTransactionOperation } from "../dynamodb/query-utils/transaction";
import type { DynamoDBItem } from "../dynamodb/query-utils/where-evaluator";
import type { AdapterMethodContext } from "./types";

type DeleteExecutionInput = {
	model: string;
	where: Where[];
	limit?: number | undefined;
};

export const createDeleteExecutor = (context: AdapterMethodContext) => {
	const {
		documentClient,
		fetchItems,
		applyClientFilter,
		mapWhereFilters,
		resolveModelTableName,
		getPrimaryKeyName,
		transactionState,
	} = context;

	return async ({ model, where, limit }: DeleteExecutionInput): Promise<number> => {
		const tableName = resolveModelTableName(model);
		const mappedWhere = mapWhereFilters(where);
		const result = await fetchItems({
			model,
			where: mappedWhere,
			limit,
		});

		const filteredItems = applyClientFilter({
			items: result.items,
			where: mappedWhere,
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

export const createDeleteManyMethod = (context: AdapterMethodContext) => {
	const executeDelete = createDeleteExecutor(context);

	return async ({ model, where }: { model: string; where: Where[] }) =>
		executeDelete({ model, where });
};
