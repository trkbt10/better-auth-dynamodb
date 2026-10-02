/**
 * @file Increment-one method for the DynamoDB adapter.
 *
 * Applies signed deltas (and absolute `set` values) to a single row matching
 * the where clause, which is both the selector and the guard. The mutation is
 * an UpdateItem whose arithmetic runs inside DynamoDB and whose
 * ConditionExpression re-checks the guard, so concurrent calls neither lose
 * updates nor mutate a row that stopped matching.
 */
import type { Where } from "@better-auth/core/db/adapter";
import type { AdapterClientContainer } from "./client-container";
import { type AtomicMethodOptions } from "./atomic-write";
export declare const createIncrementOneMethod: (client: AdapterClientContainer, options: AtomicMethodOptions) => <T>({ model, where, increment, set, }: {
    model: string;
    where: Where[];
    increment: Record<string, number>;
    set?: Record<string, unknown> | undefined;
}) => Promise<T | null>;
//# sourceMappingURL=increment-one.d.ts.map