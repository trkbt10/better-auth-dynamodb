/**
 * @file DynamoDB filter expression builder.
 */
import type { DynamoDBWhere } from "../types";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { DynamoDBAdapterError } from "../errors/errors";
import {
	getOperatorHandler,
	isClientOnlyOperator,
	type FilterExpressionContext,
} from "../where/where-operator";

export type DynamoDBFilterExpression = {
	filterExpression: string | undefined;
	expressionAttributeNames: Record<string, string>;
	expressionAttributeValues: Record<string, NativeAttributeValue>;
	requiresClientFilter: boolean;
};

const buildValueToken = (
	value: NativeAttributeValue,
	state: { index: number },
	values: Record<string, NativeAttributeValue>,
): string => {
	const token = `:v${state.index}`;
	state.index += 1;
	values[token] = value;
	return token;
};

const normalizeConnector = (connector: string | undefined): "AND" | "OR" => {
	if (connector && connector.toUpperCase() === "OR") {
		return "OR";
	}
	return "AND";
};

const hasClientOnlyOperator = (where: DynamoDBWhere[]): boolean => {
	for (const entry of where) {
		if (isClientOnlyOperator(entry.operator)) {
			return true;
		}
	}
	return false;
};

const buildCondition = (props: {
	fieldToken: string;
	operator: string | undefined;
	value: unknown;
	state: { index: number };
	values: Record<string, NativeAttributeValue>;
}): string => {
	const handler = getOperatorHandler(props.operator);
	if (!handler.buildFilterExpression) {
		throw new DynamoDBAdapterError(
			"UNSUPPORTED_OPERATOR",
			"Filter expression builder is missing.",
		);
	}
	const context: FilterExpressionContext = {
		fieldToken: props.fieldToken,
		value: props.value,
		appendValue: (value) => buildValueToken(value, props.state, props.values),
	};
	return handler.buildFilterExpression(context);
};

const combineExpressions = (props: {
	andExpressions: string[];
	orExpressions: string[];
}): string | undefined => {
	const { andExpressions, orExpressions } = props;
	const andExpression = andExpressions.join(" AND ");
	const orExpression = orExpressions.join(" OR ");

	if (andExpression && orExpression) {
		return `(${andExpression}) AND (${orExpression})`;
	}
	if (andExpression) {
		return andExpression;
	}
	if (orExpression) {
		return orExpression;
	}
	return undefined;
};

export const buildFilterExpression = (props: {
	where?: DynamoDBWhere[] | undefined;
	model: string;
	getFieldName: (args: { model: string; field: string }) => string;
}): DynamoDBFilterExpression => {
	const { where, model, getFieldName } = props;

	if (!where || where.length === 0) {
		return {
			filterExpression: undefined,
			expressionAttributeNames: {},
			expressionAttributeValues: {},
			requiresClientFilter: false,
		};
	}

	if (hasClientOnlyOperator(where)) {
		return {
			filterExpression: undefined,
			expressionAttributeNames: {},
			expressionAttributeValues: {},
			requiresClientFilter: true,
		};
	}

	const expressionAttributeNames: Record<string, string> = {};
	const expressionAttributeValues: Record<string, NativeAttributeValue> = {};
	const state = { index: 0 };

	const conditions = where.map((entry, index) => {
		const fieldName = getFieldName({ model, field: entry.field });
		const fieldToken = `#f${index}`;
		expressionAttributeNames[fieldToken] = fieldName;

		const expression = buildCondition({
			fieldToken,
			operator: entry.operator,
			value: entry.value,
			state,
			values: expressionAttributeValues,
		});

		return {
			connector: normalizeConnector(entry.connector),
			expression,
		};
	});

	const andExpressions = conditions
		.filter((condition) => condition.connector === "AND")
		.map((condition) => condition.expression);
	const orExpressions = conditions
		.filter((condition) => condition.connector === "OR")
		.map((condition) => condition.expression);

	const filterExpression = combineExpressions({
		andExpressions,
		orExpressions,
	});

	return {
		filterExpression,
		expressionAttributeNames,
		expressionAttributeValues,
		requiresClientFilter: false,
	};
};
