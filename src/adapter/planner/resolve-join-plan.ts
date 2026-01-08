/**
 * @file Resolve join plan entries for adapter query plans.
 */
import type { JoinConfig } from "@better-auth/core/db/adapter";
import type { JoinPlan } from "../query-plan";
import type { DynamoDBAdapterConfig } from "../../adapter";
import { resolveJoinStrategyHint } from "./resolve-strategy";
import { DynamoDBAdapterError } from "../../dynamodb/errors/errors";

export const resolveJoinPlan = (props: {
	join?: JoinConfig | undefined;
	getFieldName: (args: { model: string; field: string }) => string;
	getFieldAttributes: (args: { model: string; field: string }) => {
		index?: boolean | undefined;
	};
	adapterConfig: Pick<DynamoDBAdapterConfig, "indexNameResolver">;
}): JoinPlan[] => {
	if (!props) {
		throw new DynamoDBAdapterError(
			"MISSING_JOIN_PLAN_INPUT",
			"resolveJoinPlan requires explicit props.",
		);
	}
	if (!props.join || Object.keys(props.join).length === 0) {
		return [];
	}

	return Object.entries(props.join).map(([modelKey, joinConfig]) => {
		const strategy = resolveJoinStrategyHint({
			joinField: joinConfig.on.to,
			model: modelKey,
			getFieldName: props.getFieldName,
			getFieldAttributes: props.getFieldAttributes,
			adapterConfig: props.adapterConfig,
		});

		return {
			modelKey,
			model: modelKey,
			relation: joinConfig.relation ?? "one-to-many",
			on: joinConfig.on,
			limit: joinConfig.limit,
			select: undefined,
			strategy,
		};
	});
};
