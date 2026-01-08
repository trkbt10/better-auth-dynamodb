/**
 * @file Normalize Better Auth where clauses for planning.
 */
import type { Where } from "@better-auth/core/db/adapter";
import {
	isClientOnlyOperator,
	normalizeWhereOperator,
} from "../../dynamodb/expressions/where-operator";
import type { NormalizedWhere } from "../query-plan";
import { DynamoDBAdapterError } from "../../dynamodb/errors/errors";

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
		return {
			field: entry.field,
			operator,
			value: entry.value,
			connector,
			requiresClientFilter: isClientOnlyOperator(entry.operator),
		};
	});
};
