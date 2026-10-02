/**
 * @file Tests for DynamoDB where-operator handlers.
 */
import { DynamoDBAdapterError } from "../errors/errors";
import {
	getOperatorHandler,
	isClientOnlyOperator,
	normalizeWhereOperator,
	canServeAsKeyCondition,
	evaluateWhereEntry,
	isCaseInsensitiveComparison,
	requiresClientEvaluation,
} from "./where-operator";

describe("getOperatorHandler", () => {
	const captureError = (fn: () => void): unknown => {
		try {
			fn();
		} catch (error) {
			return error;
		}
		return undefined;
	};

	test("throws for unsupported operator", () => {
		const error = captureError(() => getOperatorHandler("unknown"));

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		if (error instanceof DynamoDBAdapterError) {
			expect(error.code).toBe("UNSUPPORTED_OPERATOR");
		}
	});

	test("evaluates equality", () => {
		const handler = getOperatorHandler("eq");
		expect(handler.evaluate({ fieldValue: "a", value: "a" })).toBe(true);
		expect(handler.evaluate({ fieldValue: "a", value: "b" })).toBe(false);
	});
});

describe("operator helpers", () => {
	test("detects client-only operators", () => {
		expect(isClientOnlyOperator("ends_with")).toBe(true);
		expect(isClientOnlyOperator("eq")).toBe(false);
	});

	test("normalizes operator defaults", () => {
		expect(normalizeWhereOperator(undefined)).toBe("eq");
		expect(normalizeWhereOperator("GT")).toBe("gt");
	});
});

describe("comparison operators", () => {
	test("evaluates gt with numbers", () => {
		const handler = getOperatorHandler("gt");
		expect(handler.evaluate({ fieldValue: 10, value: 5 })).toBe(true);
		expect(handler.evaluate({ fieldValue: 5, value: 10 })).toBe(false);
		expect(handler.evaluate({ fieldValue: 5, value: 5 })).toBe(false);
	});

	test("evaluates gte with numbers", () => {
		const handler = getOperatorHandler("gte");
		expect(handler.evaluate({ fieldValue: 10, value: 5 })).toBe(true);
		expect(handler.evaluate({ fieldValue: 5, value: 5 })).toBe(true);
		expect(handler.evaluate({ fieldValue: 4, value: 5 })).toBe(false);
	});

	test("evaluates lt with numbers", () => {
		const handler = getOperatorHandler("lt");
		expect(handler.evaluate({ fieldValue: 5, value: 10 })).toBe(true);
		expect(handler.evaluate({ fieldValue: 10, value: 5 })).toBe(false);
		expect(handler.evaluate({ fieldValue: 5, value: 5 })).toBe(false);
	});

	test("evaluates lte with numbers", () => {
		const handler = getOperatorHandler("lte");
		expect(handler.evaluate({ fieldValue: 5, value: 10 })).toBe(true);
		expect(handler.evaluate({ fieldValue: 5, value: 5 })).toBe(true);
		expect(handler.evaluate({ fieldValue: 10, value: 5 })).toBe(false);
	});

	test("evaluates comparison with strings", () => {
		const handler = getOperatorHandler("gt");
		expect(handler.evaluate({ fieldValue: "b", value: "a" })).toBe(true);
		expect(handler.evaluate({ fieldValue: "a", value: "b" })).toBe(false);
	});

	test("evaluates comparison with dates", () => {
		const handler = getOperatorHandler("gt");
		const earlier = new Date("2024-01-01");
		const later = new Date("2024-12-31");
		expect(handler.evaluate({ fieldValue: later, value: earlier })).toBe(true);
		expect(handler.evaluate({ fieldValue: earlier, value: later })).toBe(false);
	});

	test("returns false for incompatible types", () => {
		const handler = getOperatorHandler("gt");
		expect(handler.evaluate({ fieldValue: "a", value: 5 })).toBe(false);
		expect(handler.evaluate({ fieldValue: null, value: 5 })).toBe(false);
	});
});

describe("in/not_in operators", () => {
	test("evaluates in with array", () => {
		const handler = getOperatorHandler("in");
		expect(handler.evaluate({ fieldValue: "a", value: ["a", "b", "c"] })).toBe(true);
		expect(handler.evaluate({ fieldValue: "d", value: ["a", "b", "c"] })).toBe(false);
	});

	test("evaluates in with single value", () => {
		const handler = getOperatorHandler("in");
		expect(handler.evaluate({ fieldValue: "a", value: "a" })).toBe(true);
		expect(handler.evaluate({ fieldValue: "b", value: "a" })).toBe(false);
	});

	test("evaluates not_in with array", () => {
		const handler = getOperatorHandler("not_in");
		expect(handler.evaluate({ fieldValue: "d", value: ["a", "b", "c"] })).toBe(true);
		expect(handler.evaluate({ fieldValue: "a", value: ["a", "b", "c"] })).toBe(false);
	});
});

describe("string operators", () => {
	test("evaluates contains with string", () => {
		const handler = getOperatorHandler("contains");
		expect(handler.evaluate({ fieldValue: "hello world", value: "world" })).toBe(true);
		expect(handler.evaluate({ fieldValue: "hello world", value: "foo" })).toBe(false);
	});

	test("evaluates contains with array", () => {
		const handler = getOperatorHandler("contains");
		expect(handler.evaluate({ fieldValue: ["a", "b", "c"], value: "b" })).toBe(true);
		expect(handler.evaluate({ fieldValue: ["a", "b", "c"], value: "d" })).toBe(false);
	});

	test("evaluates contains returns false for non-string/array", () => {
		const handler = getOperatorHandler("contains");
		expect(handler.evaluate({ fieldValue: 123, value: "1" })).toBe(false);
	});

	test("evaluates starts_with", () => {
		const handler = getOperatorHandler("starts_with");
		expect(handler.evaluate({ fieldValue: "hello world", value: "hello" })).toBe(true);
		expect(handler.evaluate({ fieldValue: "hello world", value: "world" })).toBe(false);
		expect(handler.evaluate({ fieldValue: 123, value: "1" })).toBe(false);
	});

	test("evaluates ends_with", () => {
		const handler = getOperatorHandler("ends_with");
		expect(handler.evaluate({ fieldValue: "hello world", value: "world" })).toBe(true);
		expect(handler.evaluate({ fieldValue: "hello world", value: "hello" })).toBe(false);
		expect(handler.evaluate({ fieldValue: 123, value: "3" })).toBe(false);
	});

	test("evaluates ne", () => {
		const handler = getOperatorHandler("ne");
		expect(handler.evaluate({ fieldValue: "a", value: "b" })).toBe(true);
		expect(handler.evaluate({ fieldValue: "a", value: "a" })).toBe(false);
	});
});

describe("buildFilterExpression", () => {
	const createAppendValue = () => {
		const state = { counter: 0 };
		// eslint-disable-next-line @typescript-eslint/no-unused-vars -- appendValue signature requires value parameter
		return (_value: unknown) => {
			state.counter++;
			return `:v${state.counter}`;
		};
	};

	test("builds eq expression", () => {
		const handler = getOperatorHandler("eq");
		const result = handler.buildFilterExpression?.({
			fieldToken: "#field",
			value: "test",
			appendValue: createAppendValue(),
		});
		expect(result).toBe("#field = :v1");
	});

	test("builds ne expression", () => {
		const handler = getOperatorHandler("ne");
		const result = handler.buildFilterExpression?.({
			fieldToken: "#field",
			value: "test",
			appendValue: createAppendValue(),
		});
		expect(result).toBe("#field <> :v1");
	});

	test("builds gt expression", () => {
		const handler = getOperatorHandler("gt");
		const result = handler.buildFilterExpression?.({
			fieldToken: "#field",
			value: 10,
			appendValue: createAppendValue(),
		});
		expect(result).toBe("#field > :v1");
	});

	test("builds gte expression", () => {
		const handler = getOperatorHandler("gte");
		const result = handler.buildFilterExpression?.({
			fieldToken: "#field",
			value: 10,
			appendValue: createAppendValue(),
		});
		expect(result).toBe("#field >= :v1");
	});

	test("builds lt expression", () => {
		const handler = getOperatorHandler("lt");
		const result = handler.buildFilterExpression?.({
			fieldToken: "#field",
			value: 10,
			appendValue: createAppendValue(),
		});
		expect(result).toBe("#field < :v1");
	});

	test("builds lte expression", () => {
		const handler = getOperatorHandler("lte");
		const result = handler.buildFilterExpression?.({
			fieldToken: "#field",
			value: 10,
			appendValue: createAppendValue(),
		});
		expect(result).toBe("#field <= :v1");
	});

	test("builds in expression", () => {
		const handler = getOperatorHandler("in");
		const result = handler.buildFilterExpression?.({
			fieldToken: "#field",
			value: ["a", "b"],
			appendValue: createAppendValue(),
		});
		expect(result).toBe("#field IN (:v1, :v2)");
	});

	test("builds not_in expression", () => {
		const handler = getOperatorHandler("not_in");
		const result = handler.buildFilterExpression?.({
			fieldToken: "#field",
			value: ["a", "b"],
			appendValue: createAppendValue(),
		});
		expect(result).toBe("NOT (#field IN (:v1, :v2))");
	});

	test("builds contains expression", () => {
		const handler = getOperatorHandler("contains");
		const result = handler.buildFilterExpression?.({
			fieldToken: "#field",
			value: "test",
			appendValue: createAppendValue(),
		});
		expect(result).toBe("contains(#field, :v1)");
	});

	test("builds starts_with expression", () => {
		const handler = getOperatorHandler("starts_with");
		const result = handler.buildFilterExpression?.({
			fieldToken: "#field",
			value: "test",
			appendValue: createAppendValue(),
		});
		expect(result).toBe("begins_with(#field, :v1)");
	});

	test("ends_with has no buildFilterExpression", () => {
		const handler = getOperatorHandler("ends_with");
		expect(handler.buildFilterExpression).toBeUndefined();
	});

	test("compares with null as present-or-missing", () => {
		const eq = getOperatorHandler("eq");
		const ne = getOperatorHandler("ne");

		expect(
			eq.buildFilterExpression?.({
				fieldToken: "#field",
				value: null,
				appendValue: createAppendValue(),
			}),
		).toBe("(attribute_not_exists(#field) OR #field = :v1)");
		expect(
			ne.buildFilterExpression?.({
				fieldToken: "#field",
				value: null,
				appendValue: createAppendValue(),
			}),
		).toBe("(attribute_exists(#field) AND #field <> :v1)");
		expect(eq.evaluate({ fieldValue: undefined, value: null })).toBe(true);
		expect(eq.evaluate({ fieldValue: null, value: null })).toBe(true);
		expect(eq.evaluate({ fieldValue: "a", value: null })).toBe(false);
		expect(ne.evaluate({ fieldValue: undefined, value: null })).toBe(false);
		expect(ne.evaluate({ fieldValue: null, value: null })).toBe(false);
		expect(ne.evaluate({ fieldValue: "a", value: null })).toBe(true);
	});
});

describe("where entry evaluation", () => {
	const createAppendValue = () => {
		const state = { index: 0 };
		return () => {
			state.index += 1;
			return `:v${state.index}`;
		};
	};

	test("compares lists and maps by content", () => {
		const eq = getOperatorHandler("eq");
		const ne = getOperatorHandler("ne");

		expect(eq.evaluate({ fieldValue: ["a", "b"], value: ["a", "b"] })).toBe(true);
		expect(eq.evaluate({ fieldValue: ["a", "b"], value: ["b", "a"] })).toBe(false);
		expect(eq.evaluate({ fieldValue: { a: 1, b: [2] }, value: { b: [2], a: 1 } })).toBe(true);
		expect(eq.evaluate({ fieldValue: { a: 1 }, value: { a: 1, b: 2 } })).toBe(false);
		expect(ne.evaluate({ fieldValue: { a: 1 }, value: { a: 1 } })).toBe(false);
		expect(ne.evaluate({ fieldValue: { a: 1 }, value: { a: 2 } })).toBe(true);
	});

	test("treats a null in an IN list as missing or NULL", () => {
		const includes = getOperatorHandler("in");
		const excludes = getOperatorHandler("not_in");
		const list = [null, "a"];

		expect(
			includes.buildFilterExpression?.({
				fieldToken: "#field",
				value: list,
				appendValue: createAppendValue(),
			}),
		).toBe("(attribute_not_exists(#field) OR #field IN (:v1, :v2))");
		expect(
			excludes.buildFilterExpression?.({
				fieldToken: "#field",
				value: list,
				appendValue: createAppendValue(),
			}),
		).toBe("(attribute_exists(#field) AND NOT (#field IN (:v1, :v2)))");
		expect(includes.evaluate({ fieldValue: undefined, value: list })).toBe(true);
		expect(includes.evaluate({ fieldValue: null, value: list })).toBe(true);
		expect(includes.evaluate({ fieldValue: "b", value: list })).toBe(false);
		expect(excludes.evaluate({ fieldValue: undefined, value: list })).toBe(false);
		expect(excludes.evaluate({ fieldValue: "b", value: list })).toBe(true);
	});

	test("folds case only for insensitive string comparisons", () => {
		const insensitive = (operator: string, fieldValue: string, value: unknown) =>
			evaluateWhereEntry({ operator, mode: "insensitive", fieldValue, value });

		expect(insensitive("eq", "A@Example.COM", "a@example.com")).toBe(true);
		expect(insensitive("ne", "A@Example.COM", "a@example.com")).toBe(false);
		expect(insensitive("in", "Admin", ["admin", "owner"])).toBe(true);
		expect(insensitive("not_in", "Admin", ["admin", "owner"])).toBe(false);
		expect(insensitive("contains", "Hello World", "LO WO")).toBe(true);
		expect(insensitive("starts_with", "Hello", "he")).toBe(true);
		expect(insensitive("ends_with", "Hello", "LLO")).toBe(true);
		expect(
			evaluateWhereEntry({ operator: "eq", fieldValue: "A", value: "a" }),
		).toBe(false);
		expect(
			evaluateWhereEntry({
				operator: "eq",
				mode: "insensitive",
				fieldValue: 5,
				value: 5,
			}),
		).toBe(true);
	});

	test("knows which entries DynamoDB cannot evaluate", () => {
		expect(requiresClientEvaluation({ operator: "ends_with", value: "x" })).toBe(true);
		expect(requiresClientEvaluation({ mode: "insensitive", value: "x" })).toBe(true);
		expect(requiresClientEvaluation({ mode: "insensitive", value: 1 })).toBe(false);
		expect(requiresClientEvaluation({ operator: "eq", value: "x" })).toBe(false);
		expect(isCaseInsensitiveComparison({ mode: "insensitive", value: ["a"] })).toBe(true);
		expect(isCaseInsensitiveComparison({ mode: "sensitive", value: "a" })).toBe(false);
	});

	test("knows which values can be a key condition", () => {
		expect(canServeAsKeyCondition({ value: "u1" })).toBe(true);
		expect(canServeAsKeyCondition({ value: null })).toBe(false);
		expect(canServeAsKeyCondition({ value: undefined })).toBe(false);
		expect(canServeAsKeyCondition({ value: "u1", mode: "insensitive" })).toBe(false);
		expect(canServeAsKeyCondition({ value: ["a", "b"] })).toBe(true);
	});
});
