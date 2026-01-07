/**
 * @file Delete method for the DynamoDB adapter.
 */
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { Where } from "@better-auth/core/db/adapter";
import { buildPrimaryKey } from "../dynamodb/keys/primary-key";
import { addTransactionOperation } from "../dynamodb/operations/transaction";
import type { DynamoDBItem } from "../dynamodb/where/where-evaluator";
import type { AdapterMethodContext } from "./types";

export const createDeleteMethod = (context: AdapterMethodContext) => {
	const {
		documentClient,
		fetchItems,
		applyClientFilter,
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
		const result = await fetchItems({
			model,
			where: mapWhereFilters(where),
			limit: 1,
		});

		const filteredItems = applyClientFilter({
			items: result.items,
			where: mapWhereFilters(where),
			model,
			requiresClientFilter: result.requiresClientFilter,
		});

		if (filteredItems.length === 0) {
			return;
		}

		const primaryKeyName = getPrimaryKeyName(model);
		const key = buildPrimaryKey({
			item: filteredItems[0] as DynamoDBItem,
			keyField: primaryKeyName,
		});
		if (transactionState) {
			addTransactionOperation(transactionState, {
				kind: "delete",
				tableName,
				key,
			});
			return;
		}
		await documentClient.send(
			new DeleteCommand({
				TableName: tableName,
				Key: key,
			}),
		);
	};
};
