/**
 * @file Adapter query plan types.
 */

export type ExecutionStrategy =
	| { kind: "query"; key: "pk" | "gsi"; indexName?: string | undefined }
	| { kind: "multi-query"; indexName: string; field: string }
	| { kind: "batch-get" }
	| { kind: "scan" };

export type NormalizedWhere = {
	field: string;
	operator:
		| "eq"
		| "ne"
		| "lt"
		| "lte"
		| "gt"
		| "gte"
		| "in"
		| "not_in"
		| "contains"
		| "starts_with"
		| "ends_with";
	value: unknown;
	connector: "AND" | "OR";
	requiresClientFilter: boolean;
};

export type BaseQueryPlan = {
	model: string;
	where: NormalizedWhere[];
	select?: string[] | undefined;
	sort?: { field: string; direction: "asc" | "desc" } | undefined;
	limit?: number | undefined;
	offset?: number | undefined;
};

export type JoinPlan = {
	modelKey: string;
	model: string;
	relation: "one-to-one" | "one-to-many" | "many-to-many";
	on: { from: string; to: string };
	limit?: number | undefined;
	select?: string[] | undefined;
	strategy: ExecutionStrategy;
};

export type ExecutionPlan = {
	baseStrategy: ExecutionStrategy;
	joinStrategies: Record<string, ExecutionStrategy>;
	requiresClientFilter: boolean;
	requiresClientSort: boolean;
	serverSort?: { field: string; direction: "asc" | "desc" } | undefined;
	fetchLimit?: number | undefined;
};

export type PlanConstraints = {
	hasOrConnector: boolean;
	hasClientOnlyOperator: boolean;
	requiresSelectSupplement: boolean;
};

export type AdapterQueryPlan = {
	base: BaseQueryPlan;
	joins: JoinPlan[];
	execution: ExecutionPlan;
	constraints: PlanConstraints;
};
