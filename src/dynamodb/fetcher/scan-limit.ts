/**
 * @file Scan limit calculation for DynamoDB fetcher.
 */
export const resolveScanLimit = (props: {
	limit: number;
	offset: number;
	sortByDefined: boolean;
	requiresClientFilter: boolean;
}): number | undefined => {
	const { limit, offset, sortByDefined, requiresClientFilter } = props;
	if (requiresClientFilter) {
		return undefined;
	}
	if (sortByDefined) {
		return undefined;
	}
	return limit + offset;
};
