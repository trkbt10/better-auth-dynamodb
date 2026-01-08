/**
 * @file Apply select projection for adapter executor.
 */

export const applySelect = <T extends Record<string, unknown>>(props: {
	items: T[];
	model: string;
	select?: string[] | undefined;
	joinKeys: string[];
	getFieldName: (args: { model: string; field: string }) => string;
}): T[] => {
	if (!props.select || props.select.length === 0) {
		return props.items;
	}

	const selectedFields = props.select.map((field) =>
		props.getFieldName({ model: props.model, field }),
	);

	return props.items.map((item) => {
		const selection = selectedFields.reduce<Record<string, unknown>>(
			(acc, field) => {
				if (field in item) {
					acc[field] = item[field];
				}
				return acc;
			},
			{},
		);

		const joinSelection = props.joinKeys.reduce<Record<string, unknown>>(
			(acc, key) => {
				if (key in item) {
					acc[key] = item[key];
				}
				return acc;
			},
			{},
		);

		return { ...selection, ...joinSelection } as T;
	});
};
