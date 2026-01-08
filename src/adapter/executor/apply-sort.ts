/**
 * @file Sorting helpers for adapter executor.
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
		field: string;
		direction: "asc" | "desc";
	},
): T[] => {
	if (items.length <= 1) {
		return items;
	}

	const directionMultiplier = resolveDirectionMultiplier(props.direction);
	const isNullish = (value: unknown): value is null | undefined =>
		value === null || value === undefined;

	return [...items].sort((left, right) => {
		const leftValue = left[props.field];
		const rightValue = right[props.field];

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
		sortBy?: { field: string; direction: "asc" | "desc" } | undefined;
	},
): T[] => {
	if (!props.sortBy) {
		return items;
	}

	return sortItems(items, {
		field: props.sortBy.field,
		direction: props.sortBy.direction,
	});
};
