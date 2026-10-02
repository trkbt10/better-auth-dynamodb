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
	// A null in the list follows the rule for `eq null`: missing or NULL.
	const includesNull = valuesList.includes(null);
	if (props.negate) {
		if (includesNull) {
			return `(attribute_exists(${props.fieldToken}) AND NOT (${inExpression}))`;
		}
		return `NOT (${inExpression})`;
	}
	if (includesNull) {
		return `(attribute_not_exists(${props.fieldToken}) OR ${inExpression})`;
	}
	return inExpression;
};

const evaluateIn = (props: {
	fieldValue: NativeAttributeValue | undefined;
	value: unknown;
	negate: boolean;
}): boolean => {
	const valuesList = resolveValueList(props.value);
	const isIncluded = valuesList.some((entry) =>
		evaluateEquals({ fieldValue: props.fieldValue, value: entry }),
	);
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

// A null field has two representations in DynamoDB: a NULL-typed attribute,
// and no attribute at all (a row written before the field existed, or an
// index key attribute, which cannot hold NULL). A comparison with null has to
// accept both, as `IS NULL` does for a column that was never set.
const isAbsent = (value: unknown): boolean =>
	value === undefined || value === null;

const buildEqualsExpression = (ctx: FilterExpressionContext): string => {
	const valueToken = ctx.appendValue(ctx.value as NativeAttributeValue);
	if (ctx.value === null) {
		return `(attribute_not_exists(${ctx.fieldToken}) OR ${ctx.fieldToken} = ${valueToken})`;
	}
	return `${ctx.fieldToken} = ${valueToken}`;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	return Object.getPrototypeOf(value) === Object.prototype;
};

// DynamoDB compares lists and maps by content, so the in-memory evaluation
// does too: a JSON or array field equals a value with the same content.
const hasSameContent = (left: unknown, right: unknown): boolean => {
	if (left === right) {
		return true;
	}
	if (Array.isArray(left) && Array.isArray(right)) {
		if (left.length !== right.length) {
			return false;
		}
		return left.every((entry, index) => hasSameContent(entry, right[index]));
	}
	if (isPlainObject(left) && isPlainObject(right)) {
		const leftKeys = Object.keys(left);
		if (leftKeys.length !== Object.keys(right).length) {
			return false;
		}
		return leftKeys.every((key) => {
			if (!(key in right)) {
				return false;
			}
			return hasSameContent(left[key], right[key]);
		});
	}
	return false;
};

const evaluateEquals = (ctx: EvaluationContext): boolean => {
	if (ctx.value === null) {
		return isAbsent(ctx.fieldValue);
	}
	return hasSameContent(ctx.fieldValue, ctx.value);
};

const buildNotEqualsExpression = (ctx: FilterExpressionContext): string => {
	const valueToken = ctx.appendValue(ctx.value as NativeAttributeValue);
	if (ctx.value === null) {
		return `(attribute_exists(${ctx.fieldToken}) AND ${ctx.fieldToken} <> ${valueToken})`;
	}
	return `${ctx.fieldToken} <> ${valueToken}`;
};

const evaluateNotEquals = (ctx: EvaluationContext): boolean => {
	if (ctx.value === null) {
		return !isAbsent(ctx.fieldValue);
	}
	return !hasSameContent(ctx.fieldValue, ctx.value);
};

const HANDLERS: Record<WhereOperator, OperatorHandler> = {
	eq: {
		requiresClientFilter: false,
		buildFilterExpression: buildEqualsExpression,
		evaluate: evaluateEquals,
	},
	ne: {
		requiresClientFilter: false,
		buildFilterExpression: buildNotEqualsExpression,
		evaluate: evaluateNotEquals,
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

/**
 * `mode: "insensitive"` only applies to string comparisons.
 */
export const isCaseInsensitiveComparison = (entry: {
	mode?: string | undefined;
	value: unknown;
}): boolean => {
	if (entry.mode !== "insensitive") {
		return false;
	}
	if (Array.isArray(entry.value)) {
		return entry.value.some(isString);
	}
	return isString(entry.value);
};

/**
 * Whether a where entry has to be evaluated in memory: DynamoDB has neither
 * an ends_with function nor case-insensitive comparison.
 */
export const requiresClientEvaluation = (entry: {
	operator?: string | undefined;
	mode?: string | undefined;
	value: unknown;
}): boolean => {
	if (isClientOnlyOperator(entry.operator)) {
		return true;
	}
	return isCaseInsensitiveComparison(entry);
};

/**
 * Whether the value of an equality (or IN) entry can be used as a key
 * condition. A key condition is an exact, case-sensitive match on a key
 * attribute, and a key attribute never holds null: a row whose field is null
 * is simply absent from the index.
 */
export const canServeAsKeyCondition = (entry: {
	mode?: string | undefined;
	value: unknown;
}): boolean => {
	if (isCaseInsensitiveComparison(entry)) {
		return false;
	}
	if (Array.isArray(entry.value)) {
		return entry.value.every((value) => !isAbsent(value));
	}
	return !isAbsent(entry.value);
};

const foldCase = (value: unknown): unknown => {
	if (isString(value)) {
		return value.toLowerCase();
	}
	if (Array.isArray(value)) {
		return value.map((entry) => foldCase(entry));
	}
	return value;
};

/**
 * Evaluate one where entry against an attribute value in memory.
 */
export const evaluateWhereEntry = (props: {
	operator: string | undefined;
	mode?: string | undefined;
	fieldValue: NativeAttributeValue | undefined;
	value: unknown;
}): boolean => {
	const handler = getOperatorHandler(props.operator);
	if (!isCaseInsensitiveComparison(props)) {
		return handler.evaluate({ fieldValue: props.fieldValue, value: props.value });
	}
	return handler.evaluate({
		fieldValue: foldCase(props.fieldValue) as NativeAttributeValue | undefined,
		value: foldCase(props.value),
	});
};
