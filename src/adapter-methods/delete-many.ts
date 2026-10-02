/**
 * @file Delete-many method for the DynamoDB adapter.
 */
import type { Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import { buildQueryPlan } from "../adapter/planner/build-query-plan";
import { createQueryPlanExecutor } from "../adapter/executor/execute-query-plan";
import { buildPrimaryKey } from "../dynamodb/mapping/build-primary-key";
import { resolveTableName } from "../dynamodb/mapping/resolve-table-name";
import { sendConditionalDelete } from "../dynamodb/ops/conditional-write";
import {
	bufferTransactionWrite,
	type DynamoDBTransactionState,
} from "../dynamodb/ops/transaction";
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
		transactionState,
	} = options;
	const executePlan = createQueryPlanExecutor({
		documentClient,
		adapterConfig,
		getFieldName,
		getDefaultModelName,
		transactionState,
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
			adapterConfig,
		});
		const filteredItems = await executePlan(plan);

		if (filteredItems.length === 0) {
			return 0;
		}

		const primaryKeyName = getPrimaryKeyName(model);
		const state = { deleted: 0 };

		for (const item of filteredItems) {
			if (transactionState) {
				bufferTransactionWrite(transactionState, {
					tableName,
					keyField: primaryKeyName,
					row: item,
					next: null,
				});
				state.deleted += 1;
				continue;
			}
			// A row another caller deleted after it was read is not counted.
			const result = await sendConditionalDelete(documentClient, {
				TableName: tableName,
				Key: buildPrimaryKey({ item, keyField: primaryKeyName }),
				ReturnValues: "ALL_OLD",
			});
			if (result.applied && result.attributes) {
				state.deleted += 1;
			}
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
