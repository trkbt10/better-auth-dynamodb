/**
 * @file Format adapter query plans for console debugging.
 */
import type { AdapterQueryPlan, ExecutionStrategy, NormalizedWhere } from "../query-plan";
import type { ResolvedDynamoDBAdapterConfig } from "../../adapter";
import { resolveTableName } from "../../dynamodb/mapping/resolve-table-name";

const formatEstimatedAtLeastOne = (): string => ">=1";

const formatEstimatedAtMost = (max: number | undefined): string => {
	if (max === undefined) {
		return "unknown";
	}
	if (!Number.isFinite(max)) {
		return "unbounded";
	}
	return `<=${max}`;
};

const formatPrimitive = (value: unknown): string => {
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null
	) {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((entry) => JSON.stringify(entry)).join(", ")}]`;
	}
	return "…";
};

const formatWhereEntry = (entry: NormalizedWhere): string => {
	return `${entry.connector} ${entry.field} ${entry.operator} ${formatPrimitive(entry.value)}`;
};

const formatMaybeLimit = (value: number | undefined): string => {
	if (value === undefined) {
		return "∞";
	}
	return String(value);
};

const formatStrategy = (strategy: ExecutionStrategy): string => {
	if (strategy.kind === "query") {
		if (strategy.key === "pk") {
			return "query(pk)";
		}
		return `query(gsi:${strategy.indexName ?? "?"})`;
	}
	if (strategy.kind === "multi-query") {
		return `multi-query(gsi:${strategy.indexName})`;
	}
	if (strategy.kind === "batch-get") {
		return "batch-get(pk)";
	}
	return "scan";
};

const indentLines = (lines: string[], depth: number): string[] => {
	const prefix = "  ".repeat(depth);
	return lines.map((line) => `${prefix}${line}`);
};

const resolveInListSize = (props: {
	where: NormalizedWhere[];
	field?: string | undefined;
}): number | undefined => {
	const entry = props.where.find((candidate) => {
		if (candidate.operator !== "in") {
			return false;
		}
		if (!Array.isArray(candidate.value)) {
			return false;
		}
		if (props.field === undefined) {
			return true;
		}
		return candidate.field === props.field;
	});
	if (!entry) {
		return undefined;
	}
	if (!Array.isArray(entry.value)) {
		return undefined;
	}
	return entry.value.length;
};

const estimateBaseCommands = (props: {
	plan: AdapterQueryPlan;
	adapterConfig: ResolvedDynamoDBAdapterConfig;
}): string => {
	const strategy = props.plan.execution.baseStrategy;
	if (strategy.kind === "scan") {
		if (props.adapterConfig.scanPageLimitMode === "unbounded") {
			return "ScanCommand: unbounded";
		}
		return `ScanCommand: ${formatEstimatedAtMost(props.adapterConfig.scanMaxPages)}`;
	}
	if (strategy.kind === "query") {
		return `QueryCommand: ${formatEstimatedAtLeastOne()}`;
	}
	if (strategy.kind === "multi-query") {
		const inSize = resolveInListSize({
			where: props.plan.base.where,
			field: strategy.field,
		});
		if (inSize === undefined) {
			return "QueryCommand: unknown";
		}
		return `QueryCommand: =${inSize}`;
	}
	if (strategy.kind === "batch-get") {
		const inSize = resolveInListSize({ where: props.plan.base.where });
		if (inSize === undefined) {
			return "BatchGetCommand: unknown";
		}
		return `BatchGetCommand: =${Math.ceil(inSize / 100)} (chunks=${Math.ceil(inSize / 100)})`;
	}
	return "unknown";
};

const buildExplainTree = (props: {
	plan: AdapterQueryPlan;
	adapterConfig: ResolvedDynamoDBAdapterConfig;
	getDefaultModelName: (model: string) => string;
}): string[] => {
	const plan = props.plan;
	const baseTableName = resolveTableName({
		model: plan.base.model,
		getDefaultModelName: props.getDefaultModelName,
		config: props.adapterConfig,
	});

	const leafLines: string[] = [];
	const baseOp = formatStrategy(plan.execution.baseStrategy).toUpperCase();
	const fetchLimit = formatMaybeLimit(plan.execution.fetchLimit);
	const resolveScanMaxPagesValue = (): string => {
		if (plan.execution.baseStrategy.kind !== "scan") {
			return "n/a";
		}
		return formatMaybeLimit(props.adapterConfig.scanMaxPages);
	};
	const scanMaxPagesValue = resolveScanMaxPagesValue();
	leafLines.push(
		`-> ${baseOp} table=${baseTableName} fetchLimit=${fetchLimit} scanMaxPages=${scanMaxPagesValue} scanPageLimitMode=${props.adapterConfig.scanPageLimitMode}`,
	);
	leafLines.push(`   est: ${estimateBaseCommands({ plan, adapterConfig: props.adapterConfig })}`);

	if (plan.constraints.hasOrConnector || plan.constraints.hasClientOnlyOperator) {
		leafLines.push(
			`-> FILTER (client) or=${plan.constraints.hasOrConnector} clientOnly=${plan.constraints.hasClientOnlyOperator}`,
		);
	}

	if (plan.execution.requiresClientSort) {
		leafLines.push("-> SORT (client)");
	}

	if (plan.base.offset !== undefined || plan.base.limit !== undefined) {
		leafLines.push(
			`-> LIMIT offset=${plan.base.offset ?? 0} limit=${formatMaybeLimit(plan.base.limit)}`,
		);
	}

	const withJoins = plan.joins.reduce<string[]>((acc, join) => {
		const joinTableName = resolveTableName({
			model: join.model,
			getDefaultModelName: props.getDefaultModelName,
			config: props.adapterConfig,
		});
		const strategyHint = formatStrategy(join.strategy);
		const joinLines: string[] = [];
		joinLines.push(
			`-> JOIN ${join.modelKey} relation=${join.relation} on ${join.on.from} = ${join.on.to} strategy=${strategyHint} table=${joinTableName}`,
		);
		if (strategyHint === "query(pk)") {
			joinLines.push("   note: uses BATCH-GET when >1 distinct key");
		}
		return [...joinLines, ...indentLines(acc, 1)];
	}, leafLines);

	if (plan.base.select && plan.base.select.length > 0) {
		const selectList = plan.base.select.join(", ");
		return [
			`-> PROJECT (${selectList})`,
			...indentLines(withJoins, 1),
		];
	}
	return ["-> PROJECT (*)", ...indentLines(withJoins, 1)];
};

export const formatAdapterQueryPlan = (props: {
	plan: AdapterQueryPlan;
	adapterConfig: ResolvedDynamoDBAdapterConfig;
	getDefaultModelName: (model: string) => string;
}): string => {
	const lines: string[] = [];
	lines.push("EXPLAIN DynamoDBAdapter");
	lines.push(`QUERY model=${props.plan.base.model}`);

	const whereLines = props.plan.base.where.map((entry) => formatWhereEntry(entry));
	if (whereLines.length > 0) {
		lines.push("WHERE");
		for (const line of whereLines) {
			lines.push(`  ${line}`);
		}
	} else {
		lines.push("WHERE (none)");
	}

	lines.push("PLAN");
	lines.push(...indentLines(buildExplainTree(props), 1));
	return lines.join("\n");
};

export const formatPrimaryKeyLookupPlan = (props: {
	model: string;
	tableName: string;
	keyField: string;
	key: unknown;
}): string => {
	return [
		"EXPLAIN DynamoDBAdapter",
		`QUERY model=${props.model}`,
		"WHERE",
		`  AND ${props.keyField} eq ${formatPrimitive(props.key)}`,
		"PLAN",
		"  -> PROJECT (*)",
		`    -> BATCH-GET table=${props.tableName} key=${props.keyField} keys=1 chunks=1`,
	].join("\n");
};
