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
	indexKeySchemaResolver?:
		| ((args: { model: string; indexName: string }) => { partitionKey: string; sortKey?: string | undefined } | undefined)
		| undefined;
}): { entry: NormalizedWhere; indexName: string } | undefined => {
	const hasSortKeyMatch = (sortKey: string | undefined): boolean => {
		if (!sortKey) {
			return false;
		}
		return props.where.some(
			(condition) =>
				condition.operator === "eq" && condition.field === sortKey,
		);
	};

	const resolveIndexSchema = (indexName: string) => {
		if (!props.indexKeySchemaResolver) {
			return undefined;
		}
		return props.indexKeySchemaResolver({ model: props.model, indexName });
	};

	const candidates = props.where
		.filter((entry) => entry.operator === "eq")
		.map((entry) => {
			const indexName = props.indexNameResolver({
				model: props.model,
				field: entry.field,
			});
			if (!indexName) {
				return null;
			}
			const schema = resolveIndexSchema(indexName);
			const sortKey = schema?.sortKey;
			const matchedSortKey = hasSortKeyMatch(sortKey);
			return {
				entry,
				indexName,
				score: matchedSortKey ? 2 : 1,
			};
		})
		.filter((entry): entry is Exclude<typeof entry, null> => entry !== null);

	const best = candidates.reduce<
		{ entry: NormalizedWhere; indexName: string; score: number } | undefined
	>((acc, candidate) => {
		if (!acc) {
			return candidate;
		}
		if (candidate.score > acc.score) {
			return candidate;
		}
		return acc;
	}, undefined);

	if (!best) {
		return undefined;
	}
	return { entry: best.entry, indexName: best.indexName };
};

const resolveGsiInEntry = (props: {
	where: NormalizedWhere[];
	model: string;
	indexNameResolver: (args: { model: string; field: string }) => string | undefined;
}): { entry: NormalizedWhere; indexName: string } | undefined => {
	for (const entry of props.where) {
		if (entry.operator !== "in") {
			continue;
		}
		if (!Array.isArray(entry.value)) {
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
	adapterConfig: Pick<DynamoDBAdapterConfig, "indexNameResolver" | "indexKeySchemaResolver">;
}): ExecutionStrategy => {
	if (!props) {
		throw new DynamoDBAdapterError(
			"MISSING_STRATEGY_INPUT",
			"resolveBaseStrategy requires explicit props.",
		);
	}
	const andWhere = props.where.filter((entry) => entry.connector === "AND");

	const primaryKeyName = resolvePrimaryKeyName({
		model: props.model,
		getFieldName: props.getFieldName,
	});
	const pkEqEntry = resolvePkEntry({
		where: andWhere,
		primaryKeyName,
		operator: "eq",
	});
	if (pkEqEntry) {
		return { kind: "query", key: "pk" };
	}

	const gsiEntry = resolveGsiEntry({
		where: andWhere,
		model: props.model,
		indexNameResolver: props.adapterConfig.indexNameResolver,
		indexKeySchemaResolver: props.adapterConfig.indexKeySchemaResolver,
	});
	if (gsiEntry) {
		return { kind: "query", key: "gsi", indexName: gsiEntry.indexName };
	}

	const gsiInEntry = resolveGsiInEntry({
		where: andWhere,
		model: props.model,
		indexNameResolver: props.adapterConfig.indexNameResolver,
	});
	if (gsiInEntry) {
		return {
			kind: "multi-query",
			indexName: gsiInEntry.indexName,
			field: gsiInEntry.entry.field,
		};
	}

	const pkInEntry = resolvePkEntry({
		where: andWhere,
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
