/**
 * @file Consume-one method for the DynamoDB adapter.
 *
 * Deletes a single row matching the where clause and returns it. Under
 * concurrent calls for the same row exactly one caller receives it: the delete
 * is a DeleteItem whose ConditionExpression re-checks the where clause, and
 * the row handed back is the one DynamoDB reports as deleted (ALL_OLD).
 */
import type { Where } from "@better-auth/core/db/adapter";
import type { AdapterClientContainer } from "./client-container";
import { type AtomicMethodOptions } from "./atomic-write";
export declare const createConsumeOneMethod: (client: AdapterClientContainer, options: AtomicMethodOptions) => <T>({ model, where, }: {
    model: string;
    where: Where[];
}) => Promise<T | null>;
//# sourceMappingURL=consume-one.d.ts.map