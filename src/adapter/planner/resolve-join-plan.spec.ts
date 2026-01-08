/**
 * @file Tests for resolve-join-plan planner utility.
 */
import { resolveJoinPlan } from "./resolve-join-plan";

describe("resolveJoinPlan", () => {
	const getFieldName = ({ field }: { model: string; field: string }) => field;
	const indexNameResolver = () => undefined;

	test("returns empty array when no join is provided", () => {
		const result = resolveJoinPlan({
			join: undefined,
			getFieldName,
			adapterConfig: { indexNameResolver },
		});

		expect(result).toEqual([]);
	});

	test("returns empty array when join is empty object", () => {
		const result = resolveJoinPlan({
			join: {},
			getFieldName,
			adapterConfig: { indexNameResolver },
		});

		expect(result).toEqual([]);
	});

	test("creates join plan for single join config", () => {
		const result = resolveJoinPlan({
			join: {
				account: {
					on: { from: "id", to: "userId" },
				},
			},
			getFieldName,
			adapterConfig: { indexNameResolver },
		});

		expect(result).toHaveLength(1);
		expect(result[0].modelKey).toBe("account");
		expect(result[0].model).toBe("account");
		expect(result[0].on).toEqual({ from: "id", to: "userId" });
		expect(result[0].relation).toBe("one-to-many");
	});

	test("respects relation config", () => {
		const result = resolveJoinPlan({
			join: {
				user: {
					on: { from: "userId", to: "id" },
					relation: "one-to-one",
				},
			},
			getFieldName,
			adapterConfig: { indexNameResolver },
		});

		expect(result[0].relation).toBe("one-to-one");
	});

	test("respects limit config", () => {
		const result = resolveJoinPlan({
			join: {
				session: {
					on: { from: "id", to: "userId" },
					limit: 5,
				},
			},
			getFieldName,
			adapterConfig: { indexNameResolver },
		});

		expect(result[0].limit).toBe(5);
	});

	test("resolves strategy with index", () => {
		const indexResolver = (props: { model: string; field: string }) => {
			if (props.model === "session" && props.field === "userId") {
				return "session_userId_idx";
			}
			return undefined;
		};

		const result = resolveJoinPlan({
			join: {
				session: {
					on: { from: "id", to: "userId" },
				},
			},
			getFieldName,
			adapterConfig: { indexNameResolver: indexResolver },
		});

		expect(result[0].strategy.kind).toBe("query");
	});

	test("creates multiple join plans", () => {
		const result = resolveJoinPlan({
			join: {
				account: { on: { from: "id", to: "userId" } },
				session: { on: { from: "id", to: "userId" } },
			},
			getFieldName,
			adapterConfig: { indexNameResolver },
		});

		expect(result).toHaveLength(2);
	});
});
