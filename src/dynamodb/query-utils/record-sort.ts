/**
 * @file Sorting helpers for DynamoDB adapter.
 */

const resolveDirectionMultiplier = (direction: "asc" | "desc"): number => {
	if (direction === "desc") {
		return -1;
	}
	return 1;
};

export const sortItems = <T extends Record<string, unknown>>(
	items: T[],
	props: {
		model: string;
		field: string;
		direction: "asc" | "desc";
		getFieldName: (args: { model: string; field: string }) => string;
	},
): T[] => {
	if (items.length <= 1) {
		return items;
	}

	const fieldName = props.getFieldName({
		model: props.model,
		field: props.field,
	});
	const directionMultiplier = resolveDirectionMultiplier(props.direction);
	const isNullish = (value: unknown): value is null | undefined =>
		value === null || value === undefined;

	return [...items].sort((left, right) => {
		const leftValue = left[fieldName];
		const rightValue = right[fieldName];

		if (leftValue === rightValue) {
			return 0;
		}

		if (isNullish(leftValue)) {
			return 1 * directionMultiplier;
		}

		if (isNullish(rightValue)) {
			return -1 * directionMultiplier;
		}

		if (leftValue > rightValue) {
			return 1 * directionMultiplier;
		}

		if (leftValue < rightValue) {
			return -1 * directionMultiplier;
		}

		return 0;
	});
};

export const applySort = <T extends Record<string, unknown>>(
	items: T[],
	props: {
		model: string;
		sortBy?: { field: string; direction: "asc" | "desc" } | undefined;
		getFieldName: (args: { model: string; field: string }) => string;
	},
): T[] => {
	if (!props.sortBy) {
		return items;
	}

	return sortItems(items, {
		model: props.model,
		field: props.sortBy.field,
		direction: props.sortBy.direction,
		getFieldName: props.getFieldName,
	});
};
