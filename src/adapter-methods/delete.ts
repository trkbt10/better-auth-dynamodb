/**
 * @file Delete method for the DynamoDB adapter.
 */
import type { Where } from "@better-auth/core/db/adapter";
import type { AdapterClientContainer } from "./client-container";
import type { DeleteMethodOptions } from "./delete-many";
import { createDeleteExecutor } from "./delete-many";

export const createDeleteMethod = (
	client: AdapterClientContainer,
	options: DeleteMethodOptions,
) => {
	const executeDelete = createDeleteExecutor(client, options);

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
