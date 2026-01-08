/**
 * @file Sorting helpers for adapter executor.
 */
export declare const sortItems: <T extends Record<string, unknown>>(items: T[], props: {
    field: string;
    direction: "asc" | "desc";
}) => T[];
export declare const applySort: <T extends Record<string, unknown>>(items: T[], props: {
    sortBy?: {
        field: string;
        direction: "asc" | "desc";
    } | undefined;
}) => T[];
//# sourceMappingURL=apply-sort.d.ts.map