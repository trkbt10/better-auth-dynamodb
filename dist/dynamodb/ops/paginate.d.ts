/**
 * @file Shared pagination loop for DynamoDB operations.
 */
export type PaginateResult<TToken> = {
    nextToken?: TToken | undefined;
    shouldStop?: boolean | undefined;
};
type PaginateBaseOptions<TToken> = {
    initialToken?: TToken | undefined;
    fetchPage: (token: TToken | undefined, pageCount: number) => Promise<PaginateResult<TToken>>;
};
type PaginateWithMaxPages<TToken> = PaginateBaseOptions<TToken> & {
    maxPages: number;
    onMaxPages: () => never;
};
type PaginateWithoutMaxPages<TToken> = PaginateBaseOptions<TToken> & {
    maxPages?: undefined;
    onMaxPages?: undefined;
};
export type PaginateOptions<TToken> = PaginateWithMaxPages<TToken> | PaginateWithoutMaxPages<TToken>;
export declare const paginate: <TToken>(options: PaginateOptions<TToken>) => Promise<void>;
export {};
//# sourceMappingURL=paginate.d.ts.map