/**
 * @file Delete-many method for the DynamoDB adapter.
 */
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter-config";
import { buildQueryPlan } from "../adapter/planner/build-query-plan";
import { createQueryPlanExecutor } from "../adapter/executor/execute-query-plan";
import { buildPrimaryKey } from "../dynamodb/mapping/build-primary-key";
import { resolveTableName } from "../dynamodb/mapping/resolve-table-name";
import {
	addTransactionOperation,
	type DynamoDBTransactionState,
} from "../dynamodb/ops/transaction";
import type { DynamoDBItem } from "../adapter/executor/where-evaluator";
import type { AdapterClientContainer } from "./client-container";

type DeleteExecutionInput = {
	model: string;
	where: Where[];
	limit?: number | undefined;
};

export type DeleteMethodOptions = {
	adapterConfig: ResolvedDynamoDBAdapterConfig;
	getFieldName: (args: { model: string; field: string }) => string;
	getDefaultModelName: (model: string) => string;
	getFieldAttributes: (args: { model: string; field: string }) => {
		index?: boolean | undefined;
	};
	transactionState?: DynamoDBTransactionState | undefined;
};

export const createDeleteExecutor = (
	client: AdapterClientContainer,
	options: DeleteMethodOptions,
) => {
	const { documentClient } = client;
	const {
		adapterConfig,
		getFieldName,
		getDefaultModelName,
		getFieldAttributes,
		transactionState,
	} = options;
	const executePlan = createQueryPlanExecutor({
		documentClient,
		adapterConfig,
		getFieldName,
		getDefaultModelName,
		getFieldAttributes,
	});
	const resolveModelTableName = (model: string) =>
		resolveTableName({
			model,
			getDefaultModelName,
			config: adapterConfig,
		});
	const getPrimaryKeyName = (model: string) =>
		getFieldName({ model, field: "id" });

	return async ({ model, where, limit }: DeleteExecutionInput): Promise<number> => {
		const tableName = resolveModelTableName(model);
		const plan = buildQueryPlan({
			model,
			where,
			select: undefined,
			sortBy: undefined,
			limit,
			offset: undefined,
			join: undefined,
			getFieldName,
			getFieldAttributes,
			adapterConfig,
		});
		const filteredItems = await executePlan(plan);

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

export const createDeleteManyMethod = (
	client: AdapterClientContainer,
	options: DeleteMethodOptions,
) => {
	const executeDelete = createDeleteExecutor(client, options);

	return async ({ model, where }: { model: string; where: Where[] }) =>
		executeDelete({ model, where });
};
