/**
 * @file Build adapter query plan from Better Auth inputs.
 */
import type { JoinConfig, Where } from "@better-auth/core/db/adapter";
import type { DynamoDBAdapterConfig } from "../../adapter";
import type {
	AdapterQueryPlan,
	ExecutionPlan,
	PlanConstraints,
	ExecutionStrategy,
} from "../query-plan";
import { normalizeWhere, toDynamoWhere } from "./normalize-where";
import {
	buildKeyCondition,
	hasKeyAttributeFilter,
} from "../../dynamodb/expressions/build-key-condition";
import type { DynamoDBWhere } from "../../dynamodb/types";
import { resolveBaseStrategy } from "./resolve-strategy";
import { resolveJoinPlan } from "./resolve-join-plan";
import { DynamoDBAdapterError } from "../../dynamodb/errors/errors";

const resolveConstraints = (props: {
	where: ReturnType<typeof normalizeWhere>;
	requiresSelectSupplement: boolean;
}): PlanConstraints => {
	const hasOrConnector = props.where.some(
		(entry) => entry.connector === "OR",
	);
	const hasClientOnlyOperator = props.where.some(
		(entry) => entry.requiresClientFilter,
	);
	return {
		hasOrConnector,
		hasClientOnlyOperator,
		requiresSelectSupplement: props.requiresSelectSupplement,
	};
};

// A multi-query runs one Query per value of an IN list; each of them sees the
// IN entry as an equality on that value.
const toSingleQueryWhere = (props: {
	where: DynamoDBWhere[];
	strategy: ExecutionStrategy;
}): DynamoDBWhere[] => {
	const strategy = props.strategy;
	if (strategy.kind !== "multi-query") {
		return props.where;
	}
	return props.where.map((entry) => {
		if (entry.field !== strategy.field || entry.operator !== "in") {
			return entry;
		}
		if (!Array.isArray(entry.value)) {
			return entry;
		}
		return { ...entry, operator: "eq", value: entry.value[0] };
	});
};

/**
 * A Query cannot filter on the key attributes of the table or index it runs
 * on. Where entries on those attributes that are not part of the key condition
 * (a repeated key, a range on the sort key) are evaluated in memory instead.
 */
const resolveKeyAttributeFilter = (props: {
	model: string;
	where: ReturnType<typeof normalizeWhere>;
	strategy: ExecutionStrategy;
	getFieldName: (args: { model: string; field: string }) => string;
	adapterConfig: Pick<
		DynamoDBAdapterConfig,
		"indexNameResolver" | "indexKeySchemaResolver"
	>;
}): boolean => {
	if (props.strategy.kind !== "query" && props.strategy.kind !== "multi-query") {
		return false;
	}
	const keyCondition = buildKeyCondition({
		model: props.model,
		where: toSingleQueryWhere({
			where: toDynamoWhere(props.where),
			strategy: props.strategy,
		}),
		getFieldName: props.getFieldName,
		indexNameResolver: props.adapterConfig.indexNameResolver,
		indexKeySchemaResolver: props.adapterConfig.indexKeySchemaResolver,
	});
	if (!keyCondition) {
		return false;
	}
	return hasKeyAttributeFilter({
		model: props.model,
		where: keyCondition.remainingWhere,
		keyAttributes: keyCondition.keyAttributes,
		getFieldName: props.getFieldName,
	});
};

const resolveFetchLimit = (props: {
	limit?: number | undefined;
	offset?: number | undefined;
	requiresClientFilter: boolean;
	requiresClientSort: boolean;
}): number | undefined => {
	if (props.requiresClientFilter) {
		return undefined;
	}
	if (props.requiresClientSort) {
		return undefined;
	}
	if (props.limit === undefined) {
		return undefined;
	}
	const offset = props.offset ?? 0;
	return props.limit + offset;
};

const resolveNormalizedSort = (props: {
	sortBy?: { field: string; direction: "asc" | "desc" } | undefined;
	getFieldName: (args: { model: string; field: string }) => string;
	model: string;
}): { field: string; direction: "asc" | "desc" } | undefined => {
	if (!props.sortBy) {
		return undefined;
	}
	return {
		field: props.getFieldName({ model: props.model, field: props.sortBy.field }),
		direction: props.sortBy.direction,
	};
};

const resolveServerSort = (props: {
	model: string;
	baseStrategy: ExecutionStrategy;
	normalizedSort?: { field: string; direction: "asc" | "desc" } | undefined;
	adapterConfig: Pick<DynamoDBAdapterConfig, "indexKeySchemaResolver">;
}): { field: string; direction: "asc" | "desc" } | undefined => {
	if (!props.normalizedSort) {
		return undefined;
	}
	if (props.baseStrategy.kind !== "query") {
		return undefined;
	}
	if (props.baseStrategy.key !== "gsi") {
		return undefined;
	}
	if (!props.baseStrategy.indexName) {
		return undefined;
	}
	if (!props.adapterConfig.indexKeySchemaResolver) {
		return undefined;
	}
	const keySchema = props.adapterConfig.indexKeySchemaResolver({
		model: props.model,
		indexName: props.baseStrategy.indexName,
	});
	if (!keySchema || !keySchema.sortKey) {
		return undefined;
	}
	if (keySchema.sortKey !== props.normalizedSort.field) {
		return undefined;
	}
	return props.normalizedSort;
};

const resolveRequiresClientSort = (props: {
	normalizedSort?: { field: string; direction: "asc" | "desc" } | undefined;
	serverSort?: { field: string; direction: "asc" | "desc" } | undefined;
}): boolean => {
	if (!props.normalizedSort) {
		return false;
	}
	if (props.serverSort) {
		return false;
	}
	return true;
};

const resolveNormalizedSelect = (props: {
	select?: string[] | undefined;
	joins: ReturnType<typeof resolveJoinPlan>;
	getFieldName: (args: { model: string; field: string }) => string;
	model: string;
}): { select: string[] | undefined; requiresSelectSupplement: boolean } => {
	if (!props.select || props.select.length === 0) {
		return { select: props.select, requiresSelectSupplement: false };
	}
	if (props.joins.length === 0) {
		return { select: [...props.select], requiresSelectSupplement: false };
	}

	const initialState = {
		select: [...props.select],
		selectedFields: new Set(
			props.select.map((field) =>
				props.getFieldName({ model: props.model, field }),
			),
		),
		requiresSelectSupplement: false,
	};

	const resolved = props.joins.reduce((state, join) => {
		if (state.selectedFields.has(join.on.from)) {
			return state;
		}
		state.selectedFields.add(join.on.from);
		state.select.push(join.on.from);
		return {
			...state,
			requiresSelectSupplement: true,
		};
	}, initialState);

	return {
		select: resolved.select,
		requiresSelectSupplement: resolved.requiresSelectSupplement,
	};
};

export const buildQueryPlan = (props: {
	model: string;
	where?: Where[] | undefined;
	select?: string[] | undefined;
	sortBy?: { field: string; direction: "asc" | "desc" } | undefined;
	limit?: number | undefined;
	offset?: number | undefined;
	join?: JoinConfig | undefined;
	getFieldName: (args: { model: string; field: string }) => string;
	adapterConfig: Pick<
		DynamoDBAdapterConfig,
		"indexNameResolver" | "indexKeySchemaResolver"
	>;
}): AdapterQueryPlan => {
	if (!props) {
		throw new DynamoDBAdapterError(
			"MISSING_QUERY_PLAN_INPUT",
			"buildQueryPlan requires explicit props.",
		);
	}
	const normalizedWhere = normalizeWhere({ where: props.where });
	const joins = resolveJoinPlan({
		join: props.join,
		getFieldName: props.getFieldName,
		adapterConfig: props.adapterConfig,
	});
	const normalizedSelect = resolveNormalizedSelect({
		select: props.select,
		joins,
		getFieldName: props.getFieldName,
		model: props.model,
	});
	const constraints = resolveConstraints({
		where: normalizedWhere,
		requiresSelectSupplement: normalizedSelect.requiresSelectSupplement,
	});
		const baseStrategy = resolveBaseStrategy({
			model: props.model,
			where: normalizedWhere,
			getFieldName: props.getFieldName,
			adapterConfig: props.adapterConfig,
		});
	const joinStrategies = joins.reduce<Record<string, ExecutionStrategy>>(
		(acc, entry) => {
			acc[entry.modelKey] = entry.strategy;
			return acc;
		},
		{},
	);
	const resolveRequiresClientFilter = (): boolean => {
		if (constraints.hasClientOnlyOperator) {
			return true;
		}
		return resolveKeyAttributeFilter({
			model: props.model,
			where: normalizedWhere,
			strategy: baseStrategy,
			getFieldName: props.getFieldName,
			adapterConfig: props.adapterConfig,
		});
	};
	const requiresClientFilter = resolveRequiresClientFilter();
	const normalizedSort = resolveNormalizedSort({
		sortBy: props.sortBy,
		getFieldName: props.getFieldName,
		model: props.model,
	});
	const serverSort = resolveServerSort({
		model: props.model,
		baseStrategy,
		normalizedSort,
		adapterConfig: props.adapterConfig,
	});
	const requiresClientSort = resolveRequiresClientSort({
		normalizedSort,
		serverSort,
	});
	const execution: ExecutionPlan = {
		baseStrategy,
		joinStrategies,
		requiresClientFilter,
		requiresClientSort,
		serverSort,
		fetchLimit: resolveFetchLimit({
			limit: props.limit,
			offset: props.offset,
			requiresClientFilter,
			requiresClientSort,
		}),
	};

	return {
		base: {
			model: props.model,
			where: normalizedWhere,
			select: normalizedSelect.select,
			sort: normalizedSort,
			limit: props.limit,
			offset: props.offset,
		},
		joins,
		execution,
		constraints,
	};
};
