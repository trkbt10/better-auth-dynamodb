/**
 * @file In-memory where clause evaluation for DynamoDB adapter.
 */
import type { DynamoDBWhere } from "../types";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { getOperatorHandler, normalizeWhereOperator } from "./where-operator";

export type DynamoDBItem = Record<string, NativeAttributeValue>;

const normalizeConnector = (connector: string | undefined): "AND" | "OR" => {
	if (connector && connector.toUpperCase() === "OR") {
		return "OR";
	}
	return "AND";
};

const evaluateCondition = (props: {
	item: DynamoDBItem;
	fieldName: string;
	operator: string | undefined;
	value: unknown;
}): boolean => {
	const { item, fieldName, operator, value } = props;
	const fieldValue = item[fieldName];
	const handler = getOperatorHandler(operator);
	return handler.evaluate({ fieldValue, value });
};

const normalizeWhere = (props: {
	where: DynamoDBWhere[];
	model: string;
	getFieldName: (args: { model: string; field: string }) => string;
}): Array<{
	fieldName: string;
	operator: string;
	value: unknown;
	connector: "AND" | "OR";
}> => {
	const { where, model, getFieldName } = props;
	return where.map((entry) => ({
		fieldName: getFieldName({ model, field: entry.field }),
		operator: normalizeWhereOperator(entry.operator),
		value: entry.value,
		connector: normalizeConnector(entry.connector),
	}));
};

const matchesWhere = (props: {
	item: DynamoDBItem;
	conditions: ReturnType<typeof normalizeWhere>;
}): boolean => {
	const { item, conditions } = props;
	if (conditions.length === 0) {
		return true;
	}

	const resolveAndResult = (matches: boolean[]): boolean => {
		if (matches.length === 0) {
			return true;
		}
		return matches.every(Boolean);
	};

	const resolveOrResult = (matches: boolean[]): boolean => {
		if (matches.length === 0) {
			return true;
		}
		return matches.some(Boolean);
	};

	const andConditions = conditions.filter(
		(condition) => condition.connector === "AND",
	);
	const orConditions = conditions.filter(
		(condition) => condition.connector === "OR",
	);

	const andMatches = andConditions.map((condition) =>
		evaluateCondition({
			item,
			fieldName: condition.fieldName,
			operator: condition.operator,
			value: condition.value,
		}),
	);

	const orMatches = orConditions.map((condition) =>
		evaluateCondition({
			item,
			fieldName: condition.fieldName,
			operator: condition.operator,
			value: condition.value,
		}),
	);

	const andResult = resolveAndResult(andMatches);
	if (!andResult) {
		return false;
	}

	const orResult = resolveOrResult(orMatches);
	if (!orResult) {
		return false;
	}

	return true;
};

export const applyWhereFilters = (props: {
	items: DynamoDBItem[];
	where?: DynamoDBWhere[] | undefined;
	model: string;
	getFieldName: (args: { model: string; field: string }) => string;
}): DynamoDBItem[] => {
	const { items, where, model, getFieldName } = props;
	if (!where || where.length === 0) {
		return items;
	}

	const conditions = normalizeWhere({ where, model, getFieldName });
	return items.filter((item) => matchesWhere({ item, conditions }));
};
