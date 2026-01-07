/**
 * @file Delete method for the DynamoDB adapter.
 */
import type { Where } from "@better-auth/core/db/adapter";
import type { AdapterMethodContext } from "./types";
import { createDeleteExecutor } from "./delete-many";

export const createDeleteMethod = (context: AdapterMethodContext) => {
	const executeDelete = createDeleteExecutor(context);

	return async ({
		model,
		where,
	}: {
		model: string;
		where: Where[];
	}) => {
		await executeDelete({ model, where, limit: 1 });
	};
};
