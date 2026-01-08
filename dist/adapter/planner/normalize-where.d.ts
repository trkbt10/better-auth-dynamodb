/**
 * @file Normalize Better Auth where clauses for planning.
 */
import type { Where } from "@better-auth/core/db/adapter";
import type { NormalizedWhere } from "../query-plan";
export declare const normalizeWhere: (props: {
    where?: Where[] | undefined;
}) => NormalizedWhere[];
//# sourceMappingURL=normalize-where.d.ts.map