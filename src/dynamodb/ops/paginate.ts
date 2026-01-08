/**
 * @file Shared pagination loop for DynamoDB operations.
 */
export type PaginateResult<TToken> = {
	nextToken?: TToken | undefined;
	shouldStop?: boolean | undefined;
};

type PaginateBaseOptions<TToken> = {
	initialToken?: TToken | undefined;
	fetchPage: (
		token: TToken | undefined,
		pageCount: number,
	) => Promise<PaginateResult<TToken>>;
};

type PaginateWithMaxPages<TToken> = PaginateBaseOptions<TToken> & {
	maxPages: number;
	onMaxPages: () => never;
};

type PaginateWithoutMaxPages<TToken> = PaginateBaseOptions<TToken> & {
	maxPages?: undefined;
	onMaxPages?: undefined;
};

export type PaginateOptions<TToken> =
	| PaginateWithMaxPages<TToken>
	| PaginateWithoutMaxPages<TToken>;

export const paginate = async <TToken>(
	options: PaginateOptions<TToken>,
): Promise<void> => {
	const state = {
		token: options.initialToken,
		pageCount: 0,
	};

	for (;;) {
		if (
			options.maxPages !== undefined &&
			state.pageCount >= options.maxPages
		) {
			options.onMaxPages();
		}

		state.pageCount += 1;

		const result = await options.fetchPage(state.token, state.pageCount);
		const nextToken = result.nextToken;
		const shouldStop = result.shouldStop === true;

		state.token = nextToken;

		if (shouldStop || !state.token) {
			break;
		}
	}
};
