/**
 * @file Tests for the atomic increment expression builder.
 */
import { DynamoDBAdapterError } from "../errors/errors";
import {
	buildIncrementExpression,
	hasIncrementAssignments,
	resolveIncrementAssignments,
} from "./build-increment-expression";

describe("resolveIncrementAssignments", () => {
	const captureError = (fn: () => void): unknown => {
		try {
			fn();
		} catch (error) {
			return error;
		}
		return undefined;
	};

	test("drops unassigned set values and keeps null", () => {
		const assignments = resolveIncrementAssignments({
			increment: { count: 1 },
			set: { lockedUntil: null, skipped: undefined, name: "a" },
		});

		expect(assignments).toEqual({
			increment: { count: 1 },
			set: { lockedUntil: null, name: "a" },
			remove: [],
		});
		expect(hasIncrementAssignments(assignments)).toBe(true);
	});

	test("turns a null index key attribute into a removal", () => {
		const assignments = resolveIncrementAssignments({
			increment: {},
			set: { userId: null, status: "pending", note: null },
			indexKeyAttributes: ["userId"],
		});

		expect(assignments).toEqual({
			increment: {},
			set: { status: "pending", note: null },
			remove: ["userId"],
		});
		expect(hasIncrementAssignments(assignments)).toBe(true);
	});

	test("reports an empty payload", () => {
		const assignments = resolveIncrementAssignments({
			increment: {},
			set: { skipped: undefined },
		});

		expect(hasIncrementAssignments(assignments)).toBe(false);
	});

	test("rejects a non-finite delta", () => {
		const error = captureError(() =>
			resolveIncrementAssignments({
				increment: { count: Number.POSITIVE_INFINITY },
			}),
		);

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		if (error instanceof DynamoDBAdapterError) {
			expect(error.code).toBe("INVALID_UPDATE");
		}
	});

	test("rejects a field that is both incremented and set", () => {
		const error = captureError(() =>
			resolveIncrementAssignments({
				increment: { count: 1 },
				set: { count: 5 },
			}),
		);

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		if (error instanceof DynamoDBAdapterError) {
			expect(error.code).toBe("INVALID_UPDATE");
		}
	});
});

describe("buildIncrementExpression", () => {
	const captureError = (fn: () => void): unknown => {
		try {
			fn();
		} catch (error) {
			return error;
		}
		return undefined;
	};

	test("adds the delta inside DynamoDB for a numeric counter", () => {
		const expression = buildIncrementExpression({
			snapshot: { id: "u1", count: 2 },
			assignments: { increment: { count: 3 }, set: {}, remove: [] },
		});

		expect(expression.updateExpression).toBe(
			"SET #inc0 = if_not_exists(#inc0, :zero) + :inc0",
		);
		expect(expression.counterConditions).toEqual([
			"(attribute_not_exists(#inc0) OR attribute_type(#inc0, :numberType))",
		]);
		expect(expression.expressionAttributeNames).toEqual({ "#inc0": "count" });
		expect(expression.expressionAttributeValues).toEqual({
			":inc0": 3,
			":zero": 0,
			":numberType": "N",
		});
		expect(expression.nextItem).toEqual({ id: "u1", count: 5 });
	});

	test("starts an absent counter from 0", () => {
		const expression = buildIncrementExpression({
			snapshot: { id: "u1" },
			assignments: { increment: { count: -1 }, set: {}, remove: [] },
		});

		expect(expression.updateExpression).toBe(
			"SET #inc0 = if_not_exists(#inc0, :zero) + :inc0",
		);
		expect(expression.nextItem).toEqual({ id: "u1", count: -1 });
	});

	test("replaces a null counter and guards the NULL type", () => {
		const expression = buildIncrementExpression({
			snapshot: { id: "u1", count: null },
			assignments: { increment: { count: 4 }, set: {}, remove: [] },
		});

		expect(expression.updateExpression).toBe("SET #inc0 = :inc0");
		expect(expression.counterConditions).toEqual([
			"attribute_type(#inc0, :nullType)",
		]);
		expect(expression.expressionAttributeValues).toEqual({
			":inc0": 4,
			":nullType": "NULL",
		});
		expect(expression.nextItem).toEqual({ id: "u1", count: 4 });
	});

	test("combines increments and set values in one SET clause", () => {
		const expression = buildIncrementExpression({
			snapshot: { id: "u1", count: 1, other: null, name: "before" },
			assignments: {
				increment: { count: 1, other: 2 },
				set: { name: "after", lockedUntil: null },
				remove: [],
			},
		});

		expect(expression.updateExpression).toBe(
			"SET #inc0 = if_not_exists(#inc0, :zero) + :inc0, #inc1 = :inc1, #set0 = :set0, #set1 = :set1",
		);
		expect(expression.counterConditions).toEqual([
			"(attribute_not_exists(#inc0) OR attribute_type(#inc0, :numberType))",
			"attribute_type(#inc1, :nullType)",
		]);
		expect(expression.expressionAttributeNames).toEqual({
			"#inc0": "count",
			"#inc1": "other",
			"#set0": "name",
			"#set1": "lockedUntil",
		});
		expect(expression.expressionAttributeValues).toEqual({
			":inc0": 1,
			":inc1": 2,
			":zero": 0,
			":numberType": "N",
			":nullType": "NULL",
			":set0": "after",
			":set1": null,
		});
		expect(expression.nextItem).toEqual({
			id: "u1",
			count: 2,
			other: 2,
			name: "after",
			lockedUntil: null,
		});
	});

	test("emits no counter condition for a set-only payload", () => {
		const expression = buildIncrementExpression({
			snapshot: { id: "u1" },
			assignments: { increment: {}, set: { status: "accepted" }, remove: [] },
		});

		expect(expression.updateExpression).toBe("SET #set0 = :set0");
		expect(expression.counterConditions).toEqual([]);
		expect(expression.expressionAttributeValues).toEqual({
			":set0": "accepted",
		});
	});

	test("removes attributes next to the assignments, or alone", () => {
		const mixed = buildIncrementExpression({
			snapshot: { id: "d1", userId: "u1", status: "approved" },
			assignments: {
				increment: {},
				set: { status: "pending" },
				remove: ["userId"],
			},
		});
		const alone = buildIncrementExpression({
			snapshot: { id: "d1", userId: "u1" },
			assignments: { increment: {}, set: {}, remove: ["userId"] },
		});

		expect(mixed.updateExpression).toBe("SET #set0 = :set0 REMOVE #rm0");
		expect(mixed.expressionAttributeNames).toEqual({
			"#set0": "status",
			"#rm0": "userId",
		});
		expect(mixed.nextItem).toEqual({ id: "d1", status: "pending" });
		expect(alone.updateExpression).toBe("REMOVE #rm0");
		expect(alone.expressionAttributeValues).toEqual({});
		expect(alone.nextItem).toEqual({ id: "d1" });
	});

	test("rejects a counter holding a non-numeric value", () => {
		const error = captureError(() =>
			buildIncrementExpression({
				snapshot: { id: "u1", count: "3" },
				assignments: { increment: { count: 1 }, set: {}, remove: [] },
			}),
		);

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		if (error instanceof DynamoDBAdapterError) {
			expect(error.code).toBe("INVALID_UPDATE");
		}
	});

	test("rejects an empty payload", () => {
		const error = captureError(() =>
			buildIncrementExpression({
				snapshot: { id: "u1" },
				assignments: { increment: {}, set: {}, remove: [] },
			}),
		);

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
	});
});
