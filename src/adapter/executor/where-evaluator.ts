/**
 * @file In-memory where clause evaluation for adapter executor.
 */
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { getOperatorHandler, normalizeWhereOperator } from "../../dynamodb/expressions/where-operator";
import type { NormalizedWhere } from "../query-plan";

export type DynamoDBItem = Record<string, NativeAttributeValue>;

type NormalizedCondition = {
	fieldName: string;
	operator: string;
	value: unknown;
	connector: "AND" | "OR";
};

const evaluateCondition = (props: {
	item: DynamoDBItem;
	condition: NormalizedCondition;
}): boolean => {
	const handler = getOperatorHandler(props.condition.operator);
	const fieldValue = props.item[props.condition.fieldName];
	return handler.evaluate({ fieldValue, value: props.condition.value });
};

const normalizeWhere = (where: NormalizedWhere[]): NormalizedCondition[] =>
	where.map((entry) => ({
		fieldName: entry.field,
		operator: normalizeWhereOperator(entry.operator),
		value: entry.value,
		connector: entry.connector,
	}));

const matchesWhere = (props: {
	item: DynamoDBItem;
	conditions: NormalizedCondition[];
}): boolean => {
	const { item, conditions } = props;
	if (conditions.length === 0) {
		return true;
	}

	const andConditions = conditions.filter(
		(condition) => condition.connector === "AND",
	);
	const orConditions = conditions.filter(
		(condition) => condition.connector === "OR",
	);

	const andMatches = andConditions.map((condition) =>
		evaluateCondition({ item, condition }),
	);
	const orMatches = orConditions.map((condition) =>
		evaluateCondition({ item, condition }),
	);

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
	where?: NormalizedWhere[] | undefined;
}): DynamoDBItem[] => {
	if (!props.where || props.where.length === 0) {
		return props.items;
	}

	const conditions = normalizeWhere(props.where);
	return props.items.filter((item) => matchesWhere({ item, conditions }));
};
