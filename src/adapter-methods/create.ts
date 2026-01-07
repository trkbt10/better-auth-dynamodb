/**
 * @file Create method for the DynamoDB adapter.
 */
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { addTransactionOperation } from "../dynamodb/query-utils/transaction";
import type { AdapterMethodContext } from "./types";

export const createCreateMethod = (context: AdapterMethodContext) => {
	const { documentClient, resolveModelTableName, transactionState } = context;

	return async <T extends Record<string, unknown>>({
		model,
		data,
	}: {
		model: string;
		data: T;
	}) => {
		const tableName = resolveModelTableName(model);
		if (transactionState) {
			addTransactionOperation(transactionState, {
				kind: "put",
				tableName,
				item: data as Record<string, NativeAttributeValue>,
			});
			return data;
		}
		await documentClient.send(
			new PutCommand({
				TableName: tableName,
				Item: data,
			}),
		);
		return data;
	};
};
