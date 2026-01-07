/**
 * @file Tests for client-side filter application.
 */
import type { DynamoDBWhere } from "../types";
import { applyClientFilter } from "./apply-client-filter";

describe("applyClientFilter", () => {
	const getFieldName = (props: { model: string; field: string }) => props.field;

	test("returns items when filtering not required", () => {
		const items = [{ id: "1" }, { id: "2" }];
		const result = applyClientFilter({
			items,
			where: undefined,
			model: "user",
			getFieldName,
			requiresClientFilter: false,
		});

		expect(result).toBe(items);
	});

	test("filters items when required", () => {
		const items = [
			{ id: "1", name: "alpha" },
			{ id: "2", name: "beta" },
		];
		const where: DynamoDBWhere[] = [
			{ field: "name", operator: "ends_with", value: "ta" },
		];
		const result = applyClientFilter({
			items,
			where,
			model: "user",
			getFieldName,
			requiresClientFilter: true,
		});

		expect(result).toEqual([{ id: "2", name: "beta" }]);
	});
});
