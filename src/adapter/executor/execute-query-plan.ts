/**
 * @file Execute adapter query plans.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { DynamoDBAdapterConfig } from "../../adapter";
import type { AdapterQueryPlan, NormalizedWhere } from "../query-plan";
import type { DynamoDBWhere } from "../../dynamodb/types";
import type { DynamoDBItem } from "./where-evaluator";
import { applyClientFilter } from "./apply-client-filter";
import { applySort } from "./apply-sort";
import { applySelect } from "./apply-select";
import { executeJoin } from "./execute-join";
import { buildKeyCondition } from "../../dynamodb/expressions/build-key-condition";
import { buildFilterExpression } from "../../dynamodb/expressions/build-filter-expression";
import { queryItems } from "../../dynamodb/ops/query";
import { scanItems } from "../../dynamodb/ops/scan";
import { batchGetItems } from "../../dynamodb/ops/batch-get";
import { resolveTableName } from "../../dynamodb/mapping/resolve-table-name";
import { DynamoDBAdapterError } from "../../dynamodb/errors/errors";

const resolveRequiresClientFilter = (props: {
	strategy: AdapterQueryPlan["execution"]["baseStrategy"];
	requiresClientFilter: boolean;
}): boolean => {
	if (props.strategy.kind === "batch-get") {
		return true;
	}
	return props.requiresClientFilter;
};

const resolveScanMaxPages = (props: {
	adapterConfig: DynamoDBAdapterConfig;
}): number => {
	if (props.adapterConfig.scanMaxPages === undefined) {
		throw new DynamoDBAdapterError(
			"MISSING_SCAN_LIMIT",
			"Scan execution requires scanMaxPages.",
		);
	}
	return props.adapterConfig.scanMaxPages;
};

const toDynamoWhere = (where: NormalizedWhere[]): DynamoDBWhere[] =>
	where.map((entry) => ({
		field: entry.field,
		operator: entry.operator,
		value: entry.value,
		connector: entry.connector,
	}));

const resolvePrimaryKeyValues = (props: {
	where: NormalizedWhere[];
	primaryKeyName: string;
}): NativeAttributeValue[] => {
	const entry = props.where.find(
		(condition) => condition.field === props.primaryKeyName && condition.operator === "in",
	);
	if (!entry) {
		return [];
	}
	if (!Array.isArray(entry.value)) {
		return [];
	}
	return entry.value as NativeAttributeValue[];
};

const fetchBaseItems = async (props: {
	plan: AdapterQueryPlan;
	documentClient: DynamoDBDocumentClient;
	adapterConfig: DynamoDBAdapterConfig;
	getFieldName: (args: { model: string; field: string }) => string;
	getDefaultModelName: (model: string) => string;
	getFieldAttributes: (args: { model: string; field: string }) => {
		index?: boolean | undefined;
	};
}): Promise<DynamoDBItem[]> => {
	const where = toDynamoWhere(props.plan.base.where);
	const tableName = resolveTableName({
		model: props.plan.base.model,
		getDefaultModelName: props.getDefaultModelName,
		config: props.adapterConfig,
	});

	const strategy = props.plan.execution.baseStrategy;
	if (strategy.kind === "batch-get") {
		const primaryKeyName = props.getFieldName({
			model: props.plan.base.model,
			field: "id",
		});
		const keys = resolvePrimaryKeyValues({
			where: props.plan.base.where,
			primaryKeyName,
		});
		if (keys.length === 0) {
			return [];
		}
		return batchGetItems({
			documentClient: props.documentClient,
			tableName,
			keyField: primaryKeyName,
			keys,
		});
	}

	if (strategy.kind === "query") {
		const keyCondition = buildKeyCondition({
			model: props.plan.base.model,
			where,
			getFieldName: props.getFieldName,
			getFieldAttributes: props.getFieldAttributes,
			indexNameResolver: props.adapterConfig.indexNameResolver,
		});
		if (!keyCondition) {
			throw new DynamoDBAdapterError(
				"MISSING_KEY_CONDITION",
				"Query strategy requires a key condition.",
			);
		}
		const filter = buildFilterExpression({
			model: props.plan.base.model,
			where: keyCondition.remainingWhere,
			getFieldName: props.getFieldName,
		});
		const indexName =
			strategy.key === "gsi" ? strategy.indexName : keyCondition.indexName;
		return (await queryItems({
			documentClient: props.documentClient,
			tableName,
			indexName,
			keyConditionExpression: keyCondition.keyConditionExpression,
			filterExpression: filter.filterExpression,
			expressionAttributeNames: {
				...keyCondition.expressionAttributeNames,
				...filter.expressionAttributeNames,
			},
			expressionAttributeValues: {
				...keyCondition.expressionAttributeValues,
				...filter.expressionAttributeValues,
			},
			limit: props.plan.execution.fetchLimit,
		})) as DynamoDBItem[];
	}

	const filter = buildFilterExpression({
		model: props.plan.base.model,
		where,
		getFieldName: props.getFieldName,
	});
	const maxPages = resolveScanMaxPages({ adapterConfig: props.adapterConfig });
	return (await scanItems({
		documentClient: props.documentClient,
		tableName,
		filterExpression: filter.filterExpression,
		expressionAttributeNames: filter.expressionAttributeNames,
		expressionAttributeValues: filter.expressionAttributeValues,
		limit: props.plan.execution.fetchLimit,
		maxPages,
	})) as DynamoDBItem[];
};

const applyOffsetLimit = <T>(props: {
	items: T[];
	offset?: number | undefined;
	limit?: number | undefined;
}): T[] => {
	const offset = props.offset ?? 0;
	if (props.limit === undefined) {
		return props.items.slice(offset);
	}
	return props.items.slice(offset, offset + props.limit);
};

export const createQueryPlanExecutor = (props: {
	documentClient: DynamoDBDocumentClient;
	adapterConfig: DynamoDBAdapterConfig;
	getFieldName: (args: { model: string; field: string }) => string;
	getDefaultModelName: (model: string) => string;
	getFieldAttributes: (args: { model: string; field: string }) => {
		index?: boolean | undefined;
	};
}) => {
	if (!props) {
		throw new DynamoDBAdapterError(
			"MISSING_EXECUTOR_INPUT",
			"createQueryPlanExecutor requires explicit props.",
		);
	}
	return async (plan: AdapterQueryPlan): Promise<DynamoDBItem[]> => {
		const baseItems = await fetchBaseItems({
			plan,
			documentClient: props.documentClient,
			adapterConfig: props.adapterConfig,
			getFieldName: props.getFieldName,
			getDefaultModelName: props.getDefaultModelName,
			getFieldAttributes: props.getFieldAttributes,
		});

		const requiresClientFilter = resolveRequiresClientFilter({
			strategy: plan.execution.baseStrategy,
			requiresClientFilter: plan.execution.requiresClientFilter,
		});
		const filteredItems = applyClientFilter({
			items: baseItems,
			where: plan.base.where,
			requiresClientFilter,
		});

		const sortedItems = applySort(filteredItems, {
			sortBy: plan.base.sort,
		});

		const limitedItems = applyOffsetLimit({
			items: sortedItems,
			offset: plan.base.offset,
			limit: plan.base.limit,
		});

		const joinedItems = plan.joins.reduce<Promise<DynamoDBItem[]>>(
			async (accPromise, joinPlan) => {
				const items = await accPromise;
				return executeJoin({
					baseItems: items,
					join: joinPlan,
					documentClient: props.documentClient,
					adapterConfig: props.adapterConfig,
					getFieldName: props.getFieldName,
					getDefaultModelName: props.getDefaultModelName,
					getFieldAttributes: props.getFieldAttributes,
				});
			},
			Promise.resolve(limitedItems),
		);

		const itemsWithJoins = await joinedItems;
		const joinKeys = plan.joins.map((joinPlan) => joinPlan.modelKey);
		const selectedItems = applySelect({
			items: itemsWithJoins,
			model: plan.base.model,
			select: plan.base.select,
			joinKeys,
			getFieldName: props.getFieldName,
		});

		return selectedItems as DynamoDBItem[];
	};
};
