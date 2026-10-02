/**
 * @file Shared limit resolution for DynamoDB commands.
 */
export const resolveRemainingLimit = (
	limit: number | undefined,
	currentCount: number,
): number | undefined => {
	if (limit === undefined) {
		return undefined;
	}
	const remaining = limit - currentCount;
	if (remaining <= 0) {
		return 0;
	}
	return remaining;
};

/**
 * Cut a result down to the requested number of items. A page read in full
 * can return more than were still wanted.
 */
export const limitItems = <T>(items: T[], limit: number | undefined): T[] => {
	if (limit === undefined || items.length <= limit) {
		return items;
	}
	return items.slice(0, limit);
};
