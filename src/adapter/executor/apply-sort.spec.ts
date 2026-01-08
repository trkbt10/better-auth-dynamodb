/**
 * @file Tests for adapter sort helpers.
 */
import { applySort, sortItems } from "./apply-sort";

describe("sortItems", () => {
	test("sorts ascending with nulls last", () => {
		const items = [
			{ id: "a", age: 30 },
			{ id: "b", age: undefined },
			{ id: "c", age: 20 },
		];

		const sorted = sortItems(items, {
			field: "age",
			direction: "asc",
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
			field: "score",
			direction: "desc",
		});

		expect(sorted.map((item) => item.id)).toEqual(["b", "c", "a"]);
	});
});

describe("applySort", () => {
	test("returns original array when no sortBy", () => {
		const items = [{ id: "a" }, { id: "b" }];
		const result = applySort(items, {
			sortBy: undefined,
		});

		expect(result).toBe(items);
	});
});
