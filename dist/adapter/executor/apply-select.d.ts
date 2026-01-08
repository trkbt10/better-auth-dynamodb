/**
 * @file Apply select projection for adapter executor.
 */
export declare const applySelect: <T extends Record<string, unknown>>(props: {
    items: T[];
    model: string;
    select?: string[] | undefined;
    joinKeys: string[];
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
}) => T[];
//# sourceMappingURL=apply-select.d.ts.map