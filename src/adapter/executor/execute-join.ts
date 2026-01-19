/**
 * @file Execute join steps for adapter query plans.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { DynamoDBAdapterConfig } from "../../adapter";
import type { JoinPlan } from "../query-plan";
import type { DynamoDBItem } from "./where-evaluator";
import { resolveJoinStrategy } from "../planner/resolve-strategy";
import { resolveTableName } from "../../dynamodb/mapping/resolve-table-name";
import { buildFilterExpression } from "../../dynamodb/expressions/build-filter-expression";
import { buildKeyCondition } from "../../dynamodb/expressions/build-key-condition";
import { queryItems } from "../../dynamodb/ops/query";
import { scanItems } from "../../dynamodb/ops/scan";
import { batchGetItems } from "../../dynamodb/ops/batch-get";
import type { DynamoDBWhere } from "../../dynamodb/types";
import { DynamoDBAdapterError } from "../../dynamodb/errors/errors";

const resolveJoinLimit = (props: {
	relation: JoinPlan["relation"];
	limit?: number | undefined;
}): number => {
	if (props.relation === "one-to-one") {
		return 1;
	}
	if (props.limit !== undefined) {
		return props.limit;
	}
	return 100;
};

const resolveScanLimit = (props: {
	limit: number;
	baseValues: NativeAttributeValue[];
}): number | undefined => {
	if (props.baseValues.length > 1) {
		return undefined;
	}
	return props.limit;
};

	const resolveScanMaxPages = (props: {
		adapterConfig: DynamoDBAdapterConfig;
	}): number => {
		if (props.adapterConfig.scanPageLimitMode === "unbounded") {
			return Number.POSITIVE_INFINITY;
		}
		if (props.adapterConfig.scanMaxPages === undefined) {
			throw new DynamoDBAdapterError(
				"MISSING_SCAN_LIMIT",
				"Join scan requires scanMaxPages.",
			);
		}
		return props.adapterConfig.scanMaxPages;
	};

const extractBaseValues = (props: {
	items: DynamoDBItem[];
	field: string;
}): NativeAttributeValue[] => {
	const values = props.items
		.map((item) => item[props.field])
		.filter((value): value is NativeAttributeValue => value !== undefined);
	return Array.from(new Set(values));
};

const groupByJoinField = (props: {
	items: DynamoDBItem[];
	field: string;
}): Map<NativeAttributeValue, DynamoDBItem[]> => {
	const grouped = new Map<NativeAttributeValue, DynamoDBItem[]>();
	for (const item of props.items) {
		const value = item[props.field];
		if (value === undefined) {
			continue;
		}
		const current = grouped.get(value) ?? [];
		grouped.set(value, [...current, item]);
	}
	return grouped;
};

const resolveEmptyJoinValue = (
	relation: JoinPlan["relation"],
): DynamoDBItem[] | null => {
	if (relation === "one-to-one") {
		return null;
	}
	return [];
};

const resolveJoinMatches = (
	grouped: Map<NativeAttributeValue, DynamoDBItem[]>,
	value: NativeAttributeValue | undefined,
): DynamoDBItem[] => {
	if (value === undefined) {
		return [];
	}
	return grouped.get(value) ?? [];
};

const toJoinWhere = (props: {
	field: string;
	operator: DynamoDBWhere["operator"];
	value: unknown;
}): DynamoDBWhere[] => [
	{
		field: props.field,
		operator: props.operator,
		value: props.value,
		connector: "AND",
	},
];

const fetchByQuery = async (props: {
	documentClient: DynamoDBDocumentClient;
	adapterConfig: DynamoDBAdapterConfig;
	model: string;
	where: DynamoDBWhere[];
	limit?: number | undefined;
	getFieldName: (args: { model: string; field: string }) => string;
	getDefaultModelName: (model: string) => string;
}): Promise<DynamoDBItem[]> => {
	const tableName = resolveTableName({
		model: props.model,
		getDefaultModelName: props.getDefaultModelName,
		config: props.adapterConfig,
	});
	const keyCondition = buildKeyCondition({
		model: props.model,
		where: props.where,
		getFieldName: props.getFieldName,
		indexNameResolver: props.adapterConfig.indexNameResolver,
		indexKeySchemaResolver: props.adapterConfig.indexKeySchemaResolver,
	});
	if (!keyCondition) {
		throw new DynamoDBAdapterError(
			"MISSING_KEY_CONDITION",
			"Join query requires a key condition.",
		);
	}
	const filter = buildFilterExpression({
		model: props.model,
		where: keyCondition.remainingWhere,
		getFieldName: props.getFieldName,
	});
	return (await queryItems({
		documentClient: props.documentClient,
		tableName,
		indexName: keyCondition.indexName,
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
		limit: props.limit,
	})) as DynamoDBItem[];
};

const fetchByScan = async (props: {
	documentClient: DynamoDBDocumentClient;
	adapterConfig: DynamoDBAdapterConfig;
	model: string;
	where: DynamoDBWhere[];
	limit?: number | undefined;
	maxPages: number;
	getFieldName: (args: { model: string; field: string }) => string;
	getDefaultModelName: (model: string) => string;
}): Promise<DynamoDBItem[]> => {
	const tableName = resolveTableName({
		model: props.model,
		getDefaultModelName: props.getDefaultModelName,
		config: props.adapterConfig,
	});
	const filter = buildFilterExpression({
		model: props.model,
		where: props.where,
		getFieldName: props.getFieldName,
	});
	return (await scanItems({
		documentClient: props.documentClient,
		tableName,
		filterExpression: filter.filterExpression,
		expressionAttributeNames: filter.expressionAttributeNames,
		expressionAttributeValues: filter.expressionAttributeValues,
		limit: props.limit,
		maxPages: props.maxPages,
	})) as DynamoDBItem[];
};

export const executeJoin = async (props: {
	baseItems: DynamoDBItem[];
	join: JoinPlan;
	documentClient: DynamoDBDocumentClient;
	adapterConfig: DynamoDBAdapterConfig;
	getFieldName: (args: { model: string; field: string }) => string;
	getDefaultModelName: (model: string) => string;
}): Promise<DynamoDBItem[]> => {
	if (!props) {
		throw new DynamoDBAdapterError(
			"MISSING_JOIN_EXECUTION_INPUT",
			"executeJoin requires explicit props.",
		);
	}
	const baseValues = extractBaseValues({
		items: props.baseItems,
		field: props.join.on.from,
	});
	if (baseValues.length === 0) {
		return props.baseItems.map((item) => ({
			...item,
			[props.join.modelKey]: resolveEmptyJoinValue(props.join.relation),
		}));
	}

	const strategy = resolveJoinStrategy({
		joinField: props.join.on.to,
		model: props.join.model,
		baseValues,
		getFieldName: props.getFieldName,
		adapterConfig: props.adapterConfig,
	});
	const joinLimit = resolveJoinLimit({
		relation: props.join.relation,
		limit: props.join.limit,
	});
	const resolveJoinedItems = async (): Promise<DynamoDBItem[]> => {
		if (strategy.kind === "batch-get") {
			const keyField = props.join.on.to;
			return batchGetItems({
				documentClient: props.documentClient,
				tableName: resolveTableName({
					model: props.join.model,
					getDefaultModelName: props.getDefaultModelName,
					config: props.adapterConfig,
				}),
				keyField,
				keys: baseValues,
			});
		}
		if (strategy.kind === "query") {
			const initial: Promise<DynamoDBItem[]> = Promise.resolve([]);
			return baseValues.reduce(async (accPromise, value) => {
				const acc = await accPromise;
				const where = toJoinWhere({
					field: props.join.on.to,
					operator: "eq",
					value,
				});
				const items = await fetchByQuery({
					documentClient: props.documentClient,
					adapterConfig: props.adapterConfig,
					model: props.join.model,
					where,
					limit: joinLimit,
					getFieldName: props.getFieldName,
					getDefaultModelName: props.getDefaultModelName,
				});
				return [...acc, ...items];
			}, initial);
		}
		const where = toJoinWhere({
			field: props.join.on.to,
			operator: "in",
			value: baseValues,
		});
		const maxPages = resolveScanMaxPages({ adapterConfig: props.adapterConfig });
		const scanLimit = resolveScanLimit({
			limit: joinLimit,
			baseValues,
		});
		return fetchByScan({
			documentClient: props.documentClient,
			adapterConfig: props.adapterConfig,
			model: props.join.model,
			where,
			limit: scanLimit,
			maxPages,
			getFieldName: props.getFieldName,
			getDefaultModelName: props.getDefaultModelName,
		});
	};

	const joinedItems = await resolveJoinedItems();

	const grouped = groupByJoinField({
		items: joinedItems,
		field: props.join.on.to,
	});

	const resolveJoinedValue = (matches: DynamoDBItem[]): DynamoDBItem[] | DynamoDBItem | null => {
		if (props.join.relation === "one-to-one") {
			return matches[0] ?? null;
		}
		return matches.slice(0, joinLimit);
	};

	return props.baseItems.map((item) => {
		const joinValue = item[props.join.on.from];
		const matches = resolveJoinMatches(grouped, joinValue);
		const joined = resolveJoinedValue(matches);
		return {
			...item,
			[props.join.modelKey]: joined,
		};
	});
};
