/**
 * @file Update method for the DynamoDB adapter.
 */
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { Where } from "@better-auth/core/db/adapter";
import { buildUpdateExpression } from "../dynamodb/expressions/update-expression";
import { buildPrimaryKey } from "../dynamodb/keys/primary-key";
import { addTransactionOperation } from "../dynamodb/operations/transaction";
import type { DynamoDBItem } from "../dynamodb/where/where-evaluator";
import type { AdapterMethodContext } from "./types";

const applyUpdateData = <T extends Record<string, unknown>>(
	item: T,
	update: Record<string, unknown>,
): T => {
	const entries = Object.entries(update).filter(
		([, value]) => value !== undefined,
	);
	const updates = entries.reduce<Record<string, unknown>>((acc, [key, value]) => {
		acc[key] = value;
		return acc;
	}, {});
	return { ...item, ...updates };
};

export const createUpdateMethod = (context: AdapterMethodContext) => {
	const {
		documentClient,
		fetchItems,
		applyClientFilter,
		mapWhereFilters,
		resolveModelTableName,
		getPrimaryKeyName,
		transactionState,
	} = context;

	return async <T>({
		model,
		where,
		update,
	}: {
		model: string;
		where: Where[];
		update: T;
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
			return null;
		}

		const primaryKeyName = getPrimaryKeyName(model);
		const key = buildPrimaryKey({
			item: filteredItems[0] as DynamoDBItem,
			keyField: primaryKeyName,
		});
		const updateExpression = buildUpdateExpression(
			update as Record<string, NativeAttributeValue>,
		);

		if (transactionState) {
			addTransactionOperation(transactionState, {
				kind: "update",
				tableName,
				key,
				updateExpression: updateExpression.updateExpression,
				expressionAttributeNames: updateExpression.expressionAttributeNames,
				expressionAttributeValues: updateExpression.expressionAttributeValues,
			});
			return applyUpdateData(
				filteredItems[0] as Record<string, unknown>,
				update as Record<string, unknown>,
			) as T;
		}

		const updateResult = await documentClient.send(
			new UpdateCommand({
				TableName: tableName,
				Key: key,
				UpdateExpression: updateExpression.updateExpression,
				ExpressionAttributeNames: updateExpression.expressionAttributeNames,
				ExpressionAttributeValues: updateExpression.expressionAttributeValues,
				ReturnValues: "ALL_NEW",
			}),
		);

		if (!updateResult.Attributes) {
			return null;
		}

		return updateResult.Attributes as T;
	};
};
