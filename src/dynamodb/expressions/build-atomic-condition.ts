/**
 * @file Condition expression builder for atomic single-row writes.
 *
 * consumeOne / incrementOne resolve their target row first and then issue a
 * keyed DeleteItem / UpdateItem. DynamoDB has to re-evaluate the where clause
 * in the same request as the write; otherwise a row that stopped matching
 * between the read and the write would still be consumed or mutated.
 */
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { DynamoDBWhere } from "../types";
import { DynamoDBAdapterError } from "../errors/errors";
import { buildFilterExpression } from "./build-filter-expression";
import { isClientOnlyOperator } from "./where-operator";

export type AtomicCondition = {
	conditionExpression: string;
	expressionAttributeNames: Record<string, string>;
	expressionAttributeValues: Record<string, NativeAttributeValue>;
};

/**
 * A where clause can be lowered into a condition expression only when every
 * operator has a DynamoDB counterpart (ends_with does not).
 */
export const canEvaluateWhereOnServer = (where: DynamoDBWhere[]): boolean =>
	where.every((entry) => !isClientOnlyOperator(entry.operator));

const resolveUniqueFields = (fields: string[]): string[] =>
	Array.from(new Set(fields));

const buildPinnedConditions = (props: {
	fields: string[];
	snapshot: Record<string, NativeAttributeValue>;
}): AtomicCondition[] =>
	resolveUniqueFields(props.fields).map((field, index) => {
		const nameToken = `#pin${index}`;
		const value = props.snapshot[field];
		if (value === undefined) {
			return {
				conditionExpression: `attribute_not_exists(${nameToken})`,
				expressionAttributeNames: { [nameToken]: field },
				expressionAttributeValues: {},
			};
		}
		const valueToken = `:pin${index}`;
		return {
			conditionExpression: `${nameToken} = ${valueToken}`,
			expressionAttributeNames: { [nameToken]: field },
			expressionAttributeValues: { [valueToken]: value },
		};
	});

const resolveSnapshot = (
	snapshot: Record<string, NativeAttributeValue> | undefined,
): Record<string, NativeAttributeValue> => {
	if (!snapshot) {
		throw new DynamoDBAdapterError(
			"UNSUPPORTED_OPERATOR",
			"Atomic conditions that pin fields require a snapshot of the target row.",
		);
	}
	return snapshot;
};

/**
 * Build the condition guarding a keyed write.
 *
 * - The row must still exist (`attribute_exists` on the primary key).
 * - The where clause is lowered as-is when DynamoDB can evaluate it.
 * - Otherwise every field the where clause references is pinned to the value
 *   observed in the snapshot: an unchanged field keeps the client-side
 *   verdict valid, for any combination of AND / OR connectors.
 * - `pinnedFields` are pinned to the snapshot as well, for callers that hand
 *   the snapshot back as the result of the write.
 */
export const buildAtomicCondition = (props: {
	model: string;
	where: DynamoDBWhere[];
	primaryKeyName: string;
	getFieldName: (args: { model: string; field: string }) => string;
	snapshot?: Record<string, NativeAttributeValue> | undefined;
	pinnedFields?: string[] | undefined;
}): AtomicCondition => {
	const existence: AtomicCondition = {
		conditionExpression: "attribute_exists(#pk)",
		expressionAttributeNames: { "#pk": props.primaryKeyName },
		expressionAttributeValues: {},
	};
	const evaluatesOnServer = canEvaluateWhereOnServer(props.where);

	const resolveWhereCondition = (): AtomicCondition[] => {
		if (!evaluatesOnServer) {
			return [];
		}
		const filter = buildFilterExpression({
			model: props.model,
			where: props.where,
			getFieldName: props.getFieldName,
		});
		if (!filter.filterExpression) {
			return [];
		}
		return [
			{
				conditionExpression: `(${filter.filterExpression})`,
				expressionAttributeNames: filter.expressionAttributeNames,
				expressionAttributeValues: filter.expressionAttributeValues,
			},
		];
	};

	const resolvePinnedFields = (): string[] => {
		const requested = props.pinnedFields ?? [];
		if (evaluatesOnServer) {
			return requested;
		}
		const whereFields = props.where.map((entry) =>
			props.getFieldName({ model: props.model, field: entry.field }),
		);
		return [...whereFields, ...requested];
	};

	const resolvePinnedConditions = (): AtomicCondition[] => {
		const fields = resolvePinnedFields();
		if (fields.length === 0) {
			return [];
		}
		return buildPinnedConditions({
			fields,
			snapshot: resolveSnapshot(props.snapshot),
		});
	};

	const conditions = [
		existence,
		...resolveWhereCondition(),
		...resolvePinnedConditions(),
	];

	return {
		conditionExpression: conditions
			.map((condition) => condition.conditionExpression)
			.join(" AND "),
		expressionAttributeNames: conditions.reduce<Record<string, string>>(
			(acc, condition) => ({ ...acc, ...condition.expressionAttributeNames }),
			{},
		),
		expressionAttributeValues: conditions.reduce<
			Record<string, NativeAttributeValue>
		>(
			(acc, condition) => ({ ...acc, ...condition.expressionAttributeValues }),
			{},
		),
	};
};
