/**
 * @file Tests for apply-select projection.
 */
import { applySelect } from "./apply-select";

describe("applySelect", () => {
	const getFieldName = ({ field }: { model: string; field: string }) => field;

	test("returns all items when no select is provided", () => {
		const items = [
			{ id: "1", name: "Alice", email: "alice@example.com" },
			{ id: "2", name: "Bob", email: "bob@example.com" },
		];

		const result = applySelect({
			items,
			model: "user",
			select: undefined,
			joinKeys: [],
			getFieldName,
		});

		expect(result).toEqual(items);
	});

	test("returns all items when select is empty array", () => {
		const items = [{ id: "1", name: "Alice" }];

		const result = applySelect({
			items,
			model: "user",
			select: [],
			joinKeys: [],
			getFieldName,
		});

		expect(result).toEqual(items);
	});

	test("filters fields based on select", () => {
		const items = [
			{ id: "1", name: "Alice", email: "alice@example.com" },
		];

		const result = applySelect({
			items,
			model: "user",
			select: ["id", "name"],
			joinKeys: [],
			getFieldName,
		});

		expect(result).toEqual([{ id: "1", name: "Alice" }]);
	});

	test("includes join keys in output", () => {
		const items = [
			{ id: "1", name: "Alice", account: { provider: "google" } },
		];

		const result = applySelect({
			items,
			model: "user",
			select: ["id"],
			joinKeys: ["account"],
			getFieldName,
		});

		expect(result).toEqual([
			{ id: "1", account: { provider: "google" } },
		]);
	});

	test("handles missing fields gracefully", () => {
		const items = [{ id: "1" }];

		const result = applySelect({
			items,
			model: "user",
			select: ["id", "nonexistent"],
			joinKeys: ["alsoMissing"],
			getFieldName,
		});

		expect(result).toEqual([{ id: "1" }]);
	});
});
