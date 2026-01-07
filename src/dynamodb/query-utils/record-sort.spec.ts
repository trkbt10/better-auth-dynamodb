/**
 * @file Tests for DynamoDB sort helpers.
 */
import { applySort, sortItems } from "./record-sort";

describe("sortItems", () => {
	const getFieldName = (props: { model: string; field: string }) => props.field;

	test("sorts ascending with nulls last", () => {
		const items = [
			{ id: "a", age: 30 },
			{ id: "b", age: undefined },
			{ id: "c", age: 20 },
		];

		const sorted = sortItems(items, {
			model: "user",
			field: "age",
			direction: "asc",
			getFieldName,
		});

		expect(sorted.map((item) => item.id)).toEqual(["c", "a", "b"]);
	});

	test("sorts descending", () => {
		const items = [
			{ id: "a", score: 1 },
			{ id: "b", score: 3 },
			{ id: "c", score: 2 },
		];

		const sorted = sortItems(items, {
			model: "user",
			field: "score",
			direction: "desc",
			getFieldName,
		});

		expect(sorted.map((item) => item.id)).toEqual(["b", "c", "a"]);
	});
});

describe("applySort", () => {
	const getFieldName = (props: { model: string; field: string }) => props.field;

	test("returns original array when no sortBy", () => {
		const items = [{ id: "a" }, { id: "b" }];
		const result = applySort(items, {
			model: "user",
			sortBy: undefined,
			getFieldName,
		});

		expect(result).toBe(items);
	});
});
