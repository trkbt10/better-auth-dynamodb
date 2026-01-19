/**
 * @file Format adapter query plans for console debugging.
 */
import type { AdapterQueryPlan, ExecutionStrategy, NormalizedWhere } from "../query-plan";

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

export const formatAdapterQueryPlan = (plan: AdapterQueryPlan): string => {
	const lines: string[] = [];
	lines.push(`[QueryPlan] model=${plan.base.model}`);

	const whereLines = plan.base.where.map((entry) => formatWhereEntry(entry));
	if (whereLines.length > 0) {
		lines.push("  where:");
		for (const line of whereLines) {
			lines.push(`    ${line}`);
		}
	} else {
		lines.push("  where: (none)");
	}

	lines.push(
		`  base: ${formatStrategy(plan.execution.baseStrategy)} fetchLimit=${plan.execution.fetchLimit ?? "∞"}`,
	);
	lines.push(
		`  constraints: or=${plan.constraints.hasOrConnector} clientOnly=${plan.constraints.hasClientOnlyOperator} clientSort=${plan.execution.requiresClientSort}`,
	);

	if (plan.joins.length === 0) {
		lines.push("  joins: (none)");
		return lines.join("\n");
	}

	lines.push("  joins:");
	for (const join of plan.joins) {
		lines.push(
			`    ${join.modelKey}: relation=${join.relation} on ${join.on.from} -> ${join.on.to} hint=${formatStrategy(join.strategy)}`,
		);
	}
	return lines.join("\n");
};
