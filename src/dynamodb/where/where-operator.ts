/**
 * @file Where-operator handlers for DynamoDB adapter.
 */
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { DynamoDBAdapterError } from "../errors/errors";

export type WhereOperator =
	| "eq"
	| "ne"
	| "gt"
	| "gte"
	| "lt"
	| "lte"
	| "in"
	| "not_in"
	| "contains"
	| "starts_with"
	| "ends_with";

export type FilterExpressionContext = {
	fieldToken: string;
	value: unknown;
	appendValue: (value: NativeAttributeValue) => string;
};

export type EvaluationContext = {
	fieldValue: NativeAttributeValue | undefined;
	value: unknown;
};

type OperatorHandler = {
	requiresClientFilter: boolean;
	buildFilterExpression?: (ctx: FilterExpressionContext) => string;
	evaluate: (ctx: EvaluationContext) => boolean;
};

const normalizeOperatorValue = (operator: string | undefined): string => {
	if (!operator) {
		return "eq";
	}
	return operator.toLowerCase();
};

const isNumber = (value: unknown): value is number =>
	typeof value === "number" && !Number.isNaN(value);

const isString = (value: unknown): value is string => typeof value === "string";

const compareValues = (left: unknown, right: unknown): number | null => {
	if (left instanceof Date && right instanceof Date) {
		return left.getTime() - right.getTime();
	}
	if (isNumber(left) && isNumber(right)) {
		return left - right;
	}
	if (isString(left) && isString(right)) {
		if (left < right) {
			return -1;
		}
		if (left > right) {
			return 1;
		}
		return 0;
	}
	return null;
};

const resolveValueList = (value: unknown): unknown[] => {
	if (Array.isArray(value)) {
		return value;
	}
	return [value];
};

const buildComparisonExpression = (props: {
	fieldToken: string;
	value: unknown;
	operator: ">" | ">=" | "<" | "<=";
	appendValue: (value: NativeAttributeValue) => string;
}): string => {
	const valueToken = props.appendValue(props.value as NativeAttributeValue);
	return `${props.fieldToken} ${props.operator} ${valueToken}`;
};

const evaluateComparison = (props: {
	fieldValue: NativeAttributeValue | undefined;
	value: unknown;
	operator: "gt" | "gte" | "lt" | "lte";
}): boolean => {
	const comparison = compareValues(props.fieldValue, props.value);
	if (comparison === null) {
		return false;
	}
	if (props.operator === "gt") {
		return comparison > 0;
	}
	if (props.operator === "gte") {
		return comparison >= 0;
	}
	if (props.operator === "lt") {
		return comparison < 0;
	}
	return comparison <= 0;
};

const buildInExpression = (props: {
	fieldToken: string;
	value: unknown;
	appendValue: (value: NativeAttributeValue) => string;
	negate: boolean;
}): string => {
	const valuesList = resolveValueList(props.value);
	const placeholders = valuesList.map((entry) =>
		props.appendValue(entry as NativeAttributeValue),
	);
	const inExpression = `${props.fieldToken} IN (${placeholders.join(", ")})`;
	if (props.negate) {
		return `NOT (${inExpression})`;
	}
	return inExpression;
};

const evaluateIn = (props: {
	fieldValue: NativeAttributeValue | undefined;
	value: unknown;
	negate: boolean;
}): boolean => {
	const valuesList = resolveValueList(props.value);
	const isIncluded = valuesList.some((entry) => entry === props.fieldValue);
	if (props.negate) {
		return !isIncluded;
	}
	return isIncluded;
};

const buildContainsExpression = (ctx: FilterExpressionContext): string => {
	const valueToken = ctx.appendValue(ctx.value as NativeAttributeValue);
	return `contains(${ctx.fieldToken}, ${valueToken})`;
};

const evaluateContains = (ctx: EvaluationContext): boolean => {
	if (Array.isArray(ctx.fieldValue)) {
		return ctx.fieldValue.includes(ctx.value as NativeAttributeValue);
	}
	if (isString(ctx.fieldValue) && isString(ctx.value)) {
		return ctx.fieldValue.includes(ctx.value);
	}
	return false;
};

const buildStartsWithExpression = (ctx: FilterExpressionContext): string => {
	const valueToken = ctx.appendValue(ctx.value as NativeAttributeValue);
	return `begins_with(${ctx.fieldToken}, ${valueToken})`;
};

const evaluateStartsWith = (ctx: EvaluationContext): boolean => {
	if (isString(ctx.fieldValue) && isString(ctx.value)) {
		return ctx.fieldValue.startsWith(ctx.value);
	}
	return false;
};

const evaluateEndsWith = (ctx: EvaluationContext): boolean => {
	if (isString(ctx.fieldValue) && isString(ctx.value)) {
		return ctx.fieldValue.endsWith(ctx.value);
	}
	return false;
};

const HANDLERS: Record<WhereOperator, OperatorHandler> = {
	eq: {
		requiresClientFilter: false,
		buildFilterExpression: (ctx) => {
			const valueToken = ctx.appendValue(ctx.value as NativeAttributeValue);
			return `${ctx.fieldToken} = ${valueToken}`;
		},
		evaluate: (ctx) => ctx.fieldValue === ctx.value,
	},
	ne: {
		requiresClientFilter: false,
		buildFilterExpression: (ctx) => {
			const valueToken = ctx.appendValue(ctx.value as NativeAttributeValue);
			return `${ctx.fieldToken} <> ${valueToken}`;
		},
		evaluate: (ctx) => ctx.fieldValue !== ctx.value,
	},
	gt: {
		requiresClientFilter: false,
		buildFilterExpression: (ctx) =>
			buildComparisonExpression({
				fieldToken: ctx.fieldToken,
				value: ctx.value,
				operator: ">",
				appendValue: ctx.appendValue,
			}),
		evaluate: (ctx) =>
			evaluateComparison({
				fieldValue: ctx.fieldValue,
				value: ctx.value,
				operator: "gt",
			}),
	},
	gte: {
		requiresClientFilter: false,
		buildFilterExpression: (ctx) =>
			buildComparisonExpression({
				fieldToken: ctx.fieldToken,
				value: ctx.value,
				operator: ">=",
				appendValue: ctx.appendValue,
			}),
		evaluate: (ctx) =>
			evaluateComparison({
				fieldValue: ctx.fieldValue,
				value: ctx.value,
				operator: "gte",
			}),
	},
	lt: {
		requiresClientFilter: false,
		buildFilterExpression: (ctx) =>
			buildComparisonExpression({
				fieldToken: ctx.fieldToken,
				value: ctx.value,
				operator: "<",
				appendValue: ctx.appendValue,
			}),
		evaluate: (ctx) =>
			evaluateComparison({
				fieldValue: ctx.fieldValue,
				value: ctx.value,
				operator: "lt",
			}),
	},
	lte: {
		requiresClientFilter: false,
		buildFilterExpression: (ctx) =>
			buildComparisonExpression({
				fieldToken: ctx.fieldToken,
				value: ctx.value,
				operator: "<=",
				appendValue: ctx.appendValue,
			}),
		evaluate: (ctx) =>
			evaluateComparison({
				fieldValue: ctx.fieldValue,
				value: ctx.value,
				operator: "lte",
			}),
	},
	in: {
		requiresClientFilter: false,
		buildFilterExpression: (ctx) =>
			buildInExpression({
				fieldToken: ctx.fieldToken,
				value: ctx.value,
				appendValue: ctx.appendValue,
				negate: false,
			}),
		evaluate: (ctx) =>
			evaluateIn({
				fieldValue: ctx.fieldValue,
				value: ctx.value,
				negate: false,
			}),
	},
	not_in: {
		requiresClientFilter: false,
		buildFilterExpression: (ctx) =>
			buildInExpression({
				fieldToken: ctx.fieldToken,
				value: ctx.value,
				appendValue: ctx.appendValue,
				negate: true,
			}),
		evaluate: (ctx) =>
			evaluateIn({
				fieldValue: ctx.fieldValue,
				value: ctx.value,
				negate: true,
			}),
	},
	contains: {
		requiresClientFilter: false,
		buildFilterExpression: buildContainsExpression,
		evaluate: evaluateContains,
	},
	starts_with: {
		requiresClientFilter: false,
		buildFilterExpression: buildStartsWithExpression,
		evaluate: evaluateStartsWith,
	},
	ends_with: {
		requiresClientFilter: true,
		buildFilterExpression: undefined,
		evaluate: evaluateEndsWith,
	},
};

export const getOperatorHandler = (operator: string | undefined): OperatorHandler => {
	const normalized = normalizeOperatorValue(operator);
	const handler = HANDLERS[normalized as WhereOperator];
	if (!handler) {
		throw new DynamoDBAdapterError(
			"UNSUPPORTED_OPERATOR",
			`Unsupported operator: ${operator}`,
		);
	}
	return handler;
};

export const isClientOnlyOperator = (operator: string | undefined): boolean => {
	const handler = getOperatorHandler(operator);
	return handler.requiresClientFilter;
};

export const normalizeWhereOperator = (operator: string | undefined): string =>
	normalizeOperatorValue(operator);
