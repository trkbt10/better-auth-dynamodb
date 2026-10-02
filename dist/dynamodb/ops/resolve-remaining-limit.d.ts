/**
 * @file Shared limit resolution for DynamoDB commands.
 */
export declare const resolveRemainingLimit: (limit: number | undefined, currentCount: number) => number | undefined;
/**
 * Cut a result down to the requested number of items. A page read in full
 * can return more than were still wanted.
 */
export declare const limitItems: <T>(items: T[], limit: number | undefined) => T[];
//# sourceMappingURL=resolve-remaining-limit.d.ts.map