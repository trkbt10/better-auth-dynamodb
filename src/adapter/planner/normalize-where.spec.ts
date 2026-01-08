/**
 * @file Tests for normalize-where planner utility.
 */
import { normalizeWhere } from "./normalize-where";

describe("normalizeWhere", () => {
	test("returns empty array for undefined where", () => {
		const result = normalizeWhere({ where: undefined });
		expect(result).toEqual([]);
	});

	test("returns empty array for empty where array", () => {
		const result = normalizeWhere({ where: [] });
		expect(result).toEqual([]);
	});

	test("normalizes basic equality clause", () => {
		const result = normalizeWhere({
			where: [{ field: "email", value: "test@example.com" }],
		});

		expect(result).toEqual([
			{
				field: "email",
				operator: "eq",
				value: "test@example.com",
				connector: "AND",
				requiresClientFilter: false,
			},
		]);
	});

	test("normalizes OR connector", () => {
		const result = normalizeWhere({
			where: [
				{ field: "email", value: "a@example.com", connector: "OR" },
				{ field: "email", value: "b@example.com", connector: "OR" },
			],
		});

		expect(result[0].connector).toBe("OR");
		expect(result[1].connector).toBe("OR");
	});

	test("normalizes case-insensitive OR connector", () => {
		const result = normalizeWhere({
			where: [{ field: "email", value: "test@example.com", connector: "or" as "OR" }],
		});

		expect(result[0].connector).toBe("OR");
	});

	test("marks ends_with as requiring client filter", () => {
		const result = normalizeWhere({
			where: [{ field: "email", operator: "ends_with", value: "@example.com" }],
		});

		expect(result[0].requiresClientFilter).toBe(true);
	});

	test("marks eq as not requiring client filter", () => {
		const result = normalizeWhere({
			where: [{ field: "id", operator: "eq", value: "123" }],
		});

		expect(result[0].requiresClientFilter).toBe(false);
	});
});
