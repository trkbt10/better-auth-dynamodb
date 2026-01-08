/**
 * @file Resolve execution strategies for adapter query plans.
 */
import type { NormalizedWhere, ExecutionStrategy } from "../query-plan";
import type { DynamoDBAdapterConfig } from "../../adapter";
import { DynamoDBAdapterError } from "../../dynamodb/errors/errors";

const resolvePrimaryKeyName = (props: {
	model: string;
	getFieldName: (args: { model: string; field: string }) => string;
}): string => props.getFieldName({ model: props.model, field: "id" });

const resolvePkEntry = (props: {
	where: NormalizedWhere[];
	primaryKeyName: string;
	operator: "eq" | "in";
}): NormalizedWhere | undefined =>
	props.where.find(
		(entry) => entry.operator === props.operator && entry.field === props.primaryKeyName,
	);

const resolveGsiEntry = (props: {
	where: NormalizedWhere[];
	model: string;
	indexNameResolver: (args: { model: string; field: string }) => string | undefined;
}): { entry: NormalizedWhere; indexName: string } | undefined => {
	for (const entry of props.where) {
		if (entry.operator !== "eq") {
			continue;
		}
		const indexName = props.indexNameResolver({
			model: props.model,
			field: entry.field,
		});
		if (!indexName) {
			continue;
		}
		return { entry, indexName };
	}

	return undefined;
};

export const resolveBaseStrategy = (props: {
	model: string;
	where: NormalizedWhere[];
	getFieldName: (args: { model: string; field: string }) => string;
	adapterConfig: Pick<DynamoDBAdapterConfig, "indexNameResolver">;
	hasOrConnector: boolean;
}): ExecutionStrategy => {
	if (!props) {
		throw new DynamoDBAdapterError(
			"MISSING_STRATEGY_INPUT",
			"resolveBaseStrategy requires explicit props.",
		);
	}
	if (props.hasOrConnector) {
		return { kind: "scan" };
	}

	const primaryKeyName = resolvePrimaryKeyName({
		model: props.model,
		getFieldName: props.getFieldName,
	});
	const pkEqEntry = resolvePkEntry({
		where: props.where,
		primaryKeyName,
		operator: "eq",
	});
	if (pkEqEntry) {
		return { kind: "query", key: "pk" };
	}

	const gsiEntry = resolveGsiEntry({
		where: props.where,
		model: props.model,
		indexNameResolver: props.adapterConfig.indexNameResolver,
	});
	if (gsiEntry) {
		return { kind: "query", key: "gsi", indexName: gsiEntry.indexName };
	}

	const pkInEntry = resolvePkEntry({
		where: props.where,
		primaryKeyName,
		operator: "in",
	});
	if (pkInEntry && Array.isArray(pkInEntry.value)) {
		return { kind: "batch-get" };
	}

	return { kind: "scan" };
};

export const resolveJoinStrategyHint = (props: {
	joinField: string;
	model: string;
	getFieldName: (args: { model: string; field: string }) => string;
	adapterConfig: Pick<DynamoDBAdapterConfig, "indexNameResolver">;
}): ExecutionStrategy => {
	if (!props) {
		throw new DynamoDBAdapterError(
			"MISSING_JOIN_STRATEGY_INPUT",
			"resolveJoinStrategyHint requires explicit props.",
		);
	}
	const primaryKeyName = resolvePrimaryKeyName({
		model: props.model,
		getFieldName: props.getFieldName,
	});
	if (props.joinField === primaryKeyName) {
		return { kind: "query", key: "pk" };
	}

	const indexName = props.adapterConfig.indexNameResolver({
		model: props.model,
		field: props.joinField,
	});
	if (indexName) {
		return { kind: "query", key: "gsi", indexName };
	}

	return { kind: "scan" };
};

export const resolveJoinStrategy = (props: {
	joinField: string;
	model: string;
	baseValues: unknown[];
	getFieldName: (args: { model: string; field: string }) => string;
	adapterConfig: Pick<DynamoDBAdapterConfig, "indexNameResolver">;
}): ExecutionStrategy => {
	if (!props) {
		throw new DynamoDBAdapterError(
			"MISSING_JOIN_STRATEGY_INPUT",
			"resolveJoinStrategy requires explicit props.",
		);
	}
	const hint = resolveJoinStrategyHint({
		joinField: props.joinField,
		model: props.model,
		getFieldName: props.getFieldName,
		adapterConfig: props.adapterConfig,
	});

	if (hint.kind === "query" && hint.key === "pk" && props.baseValues.length > 1) {
		return { kind: "batch-get" };
	}

	return hint;
};
