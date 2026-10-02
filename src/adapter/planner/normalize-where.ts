/**
 * @file Normalize Better Auth where clauses for planning.
 */
import type { Where } from "@better-auth/core/db/adapter";
import {
	isCaseInsensitiveComparison,
	normalizeWhereOperator,
	requiresClientEvaluation,
} from "../../dynamodb/expressions/where-operator";
import type { NormalizedWhere } from "../query-plan";
import { DynamoDBAdapterError } from "../../dynamodb/errors/errors";
import type { DynamoDBWhere } from "../../dynamodb/types";

export const toDynamoWhere = (where: NormalizedWhere[]): DynamoDBWhere[] =>
	where.map((entry) => ({
		field: entry.field,
		operator: entry.operator,
		value: entry.value,
		connector: entry.connector,
		mode: entry.mode,
	}));

export const normalizeWhere = (props: {
	where?: Where[] | undefined;
}): NormalizedWhere[] => {
	if (!props) {
		throw new DynamoDBAdapterError(
			"MISSING_WHERE_INPUT",
			"normalizeWhere requires explicit props.",
		);
	}
	const { where } = props;
	if (!where || where.length === 0) {
		return [];
	}

	const normalizeConnector = (connector: Where["connector"]): "AND" | "OR" => {
		if (connector && connector.toUpperCase() === "OR") {
			return "OR";
		}
		return "AND";
	};

	return where.map((entry) => {
		const operator = normalizeWhereOperator(
			entry.operator,
		) as NormalizedWhere["operator"];
		const connector = normalizeConnector(entry.connector);
		const resolveMode = (): NormalizedWhere["mode"] => {
			if (isCaseInsensitiveComparison(entry)) {
				return "insensitive";
			}
			return "sensitive";
		};
		return {
			field: entry.field,
			operator,
			value: entry.value,
			connector,
			mode: resolveMode(),
			requiresClientFilter: requiresClientEvaluation(entry),
		};
	});
};
