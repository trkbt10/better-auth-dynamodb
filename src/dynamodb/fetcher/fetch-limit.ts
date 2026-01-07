/**
 * @file Fetch limit calculation for DynamoDB fetcher.
 */
export const resolveFetchLimit = (props: {
	limit?: number | undefined;
	requiresClientFilter: boolean;
}): number | undefined => {
	if (props.requiresClientFilter) {
		return undefined;
	}
	return props.limit;
};
