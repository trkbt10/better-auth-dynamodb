import type { BetterAuthOptions } from "@better-auth/core";
import type { Where } from "@better-auth/core/db/adapter";
export declare const createRateLimitKeyMapping: (props: {
    options: BetterAuthOptions;
    getDefaultModelName: (model: string) => string;
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
}) => {
    create: <T extends {
        model: string;
        data: Record<string, unknown>;
    }>(input: T) => T;
    where: <T extends {
        model: string;
        where?: Where[] | undefined;
    }>(input: T) => T;
    assertMutable: (model: string, assignments: unknown) => void;
    applies: (model: string) => boolean;
};
