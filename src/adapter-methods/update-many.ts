/**
 * @file Update-many method for the DynamoDB adapter.
 */
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { Where } from "@better-auth/core/db/adapter";
import { buildUpdateExpression } from "../dynamodb/expressions/update-expression";
import { buildPrimaryKey } from "../dynamodb/keys/primary-key";
import { addTransactionOperation } from "../dynamodb/operations/transaction";
import type { DynamoDBItem } from "../dynamodb/where/where-evaluator";
import type { AdapterMethodContext } from "./types";

export const createUpdateManyMethod = (context: AdapterMethodContext) => {
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
		update,
	}: {
		model: string;
		where: Where[];
		update: Record<string, unknown>;
	}) => {
		const tableName = resolveModelTableName(model);
		const result = await fetchItems({
			model,
			where: mapWhereFilters(where),
		});

		const filteredItems = applyClientFilter({
			items: result.items,
			where: mapWhereFilters(where),
			model,
			requiresClientFilter: result.requiresClientFilter,
		});

		if (filteredItems.length === 0) {
			return 0;
		}

		const primaryKeyName = getPrimaryKeyName(model);
		const updateExpression = buildUpdateExpression(
			update as Record<string, NativeAttributeValue>,
		);
		const state = { updated: 0 };

		for (const item of filteredItems) {
			const key = buildPrimaryKey({
				item: item as DynamoDBItem,
				keyField: primaryKeyName,
			});
			if (transactionState) {
				addTransactionOperation(transactionState, {
					kind: "update",
					tableName,
					key,
					updateExpression: updateExpression.updateExpression,
					expressionAttributeNames:
						updateExpression.expressionAttributeNames,
					expressionAttributeValues:
						updateExpression.expressionAttributeValues,
				});
			} else {
				await documentClient.send(
					new UpdateCommand({
						TableName: tableName,
						Key: key,
						UpdateExpression: updateExpression.updateExpression,
						ExpressionAttributeNames:
							updateExpression.expressionAttributeNames,
						ExpressionAttributeValues:
							updateExpression.expressionAttributeValues,
					}),
				);
			}
			state.updated += 1;
		}

		return state.updated;
	};
};
