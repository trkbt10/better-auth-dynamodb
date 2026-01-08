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
