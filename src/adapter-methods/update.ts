/**
 * @file Update method for the DynamoDB adapter.
 */
import type { Where } from "@better-auth/core/db/adapter";
import type { AdapterMethodContext } from "./types";
import { createUpdateExecutor } from "./update-many";

export const createUpdateMethod = (context: AdapterMethodContext) => {
	const executeUpdate = createUpdateExecutor(context);

	return async <T>({
		model,
		where,
		update,
	}: {
		model: string;
		where: Where[];
		update: T;
	}) => {
		const result = await executeUpdate({
			model,
			where,
			update: update as Record<string, unknown>,
			limit: 1,
			returnUpdatedItems: true,
		});

		if (result.updatedItems.length === 0) {
			return null;
		}

		return result.updatedItems[0] as T;
	};
};
