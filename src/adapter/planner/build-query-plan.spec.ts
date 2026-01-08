/**
 * @file Tests for query plan building with Better Auth joins.
 */
import type { BetterAuthOptions } from "@better-auth/core";
import { getAuthTables } from "@better-auth/core/db";
import { initGetFieldName } from "@better-auth/core/db/adapter";
import type { JoinConfig } from "@better-auth/core/db/adapter";
import { buildQueryPlan } from "./build-query-plan";

const buildSchemaHelpers = () => {
	const options: BetterAuthOptions = {};
	const schema = getAuthTables(options);
	const getFieldName = initGetFieldName({
		schema,
		usePlural: false,
	});
	return {
		getFieldName,
	};
};

const indexNameResolver = (props: { model: string; field: string }) => {
	if (props.model === "session" && props.field === "userId") {
		return "session_userId_idx";
	}
	return undefined;
};

describe("buildQueryPlan", () => {
	const helpers = buildSchemaHelpers();

	test("plans join strategies using Better Auth indexed fields", () => {
		const join: JoinConfig = {
			session: {
				relation: "one-to-many",
				on: {
					from: helpers.getFieldName({ model: "user", field: "id" }),
					to: helpers.getFieldName({ model: "session", field: "userId" }),
				},
				limit: 10,
			},
		};
		const plan = buildQueryPlan({
			model: "user",
			where: [
				{
					field: helpers.getFieldName({ model: "user", field: "id" }),
					operator: "eq",
					value: "user_1",
				},
			],
			select: ["id"],
			sortBy: undefined,
			limit: 10,
			offset: 0,
			join,
			getFieldName: helpers.getFieldName,
			adapterConfig: { indexNameResolver },
		});

		expect(plan.joins.length).toBe(1);
		expect(plan.execution.joinStrategies.session).toEqual({
			kind: "query",
			key: "gsi",
			indexName: "session_userId_idx",
		});
	});
});
