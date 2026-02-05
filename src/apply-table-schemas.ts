/**
 * @file DynamoDB table schema application helpers for Better Auth adapter.
 */
import {
	CreateTableCommand,
	DescribeTableCommand,
	ListTablesCommand,
	UpdateTableCommand,
	waitUntilTableExists,
	type AttributeDefinition,
	type DynamoDBClient,
	type GlobalSecondaryIndex,
	type GlobalSecondaryIndexDescription,
} from "@aws-sdk/client-dynamodb";
import type { TableSchema } from "./dynamodb/types";
import { DynamoDBAdapterError } from "./dynamodb/errors/errors";

type WaiterConfiguration = Omit<
	Parameters<typeof waitUntilTableExists>[0],
	"client"
>;

export type ApplyTableSchemasOptions = {
	client: DynamoDBClient;
	tables: TableSchema[];
	wait?: WaiterConfiguration | undefined;
};

export type ApplyTableSchemasResult = {
	createdTables: string[];
	updatedTables: string[];
};

const sleep = async (ms: number): Promise<void> => {
	if (ms <= 0) {
		return;
	}
	await new Promise<void>((resolve) => {
		setTimeout(() => resolve(), ms);
	});
};

const listTableNames = async (client: DynamoDBClient): Promise<string[]> => {
	const tableNames: string[] = [];
	const state = { lastEvaluatedTableName: undefined as string | undefined };

	for (;;) {
		const response = await client.send(
			new ListTablesCommand({
				ExclusiveStartTableName: state.lastEvaluatedTableName,
			}),
		);
		tableNames.push(...(response.TableNames ?? []));
		state.lastEvaluatedTableName = response.LastEvaluatedTableName;
		if (!state.lastEvaluatedTableName) {
			break;
		}
	}

	return tableNames;
};

const describeTable = async (
	client: DynamoDBClient,
	tableName: string,
): Promise<NonNullable<Awaited<ReturnType<DynamoDBClient["send"]>>["Table"]>> => {
	const response = await client.send(new DescribeTableCommand({ TableName: tableName }));
	if (!response.Table) {
		throw new DynamoDBAdapterError(
			"MISSING_TABLE_SCHEMA",
			`DescribeTable did not return a Table for ${tableName}.`,
		);
	}
	return response.Table;
};

const normalizeKeySchema = (
	keySchema: { AttributeName?: string; KeyType?: string }[] | undefined,
): { attributeName: string; keyType: string }[] => {
	const entries = keySchema ?? [];
	return entries
		.map((entry) => ({
			attributeName: entry.AttributeName ?? "",
			keyType: entry.KeyType ?? "",
		}))
		.filter((entry) => entry.attributeName.length > 0 && entry.keyType.length > 0);
};

const normalizeProjection = (
	projection:
		| { ProjectionType?: string | undefined; NonKeyAttributes?: string[] | undefined }
		| undefined,
): { projectionType: string; nonKeyAttributes: string[] } => {
	const projectionType = projection?.ProjectionType ?? "";
	const nonKeyAttributes = [...(projection?.NonKeyAttributes ?? [])].sort((a, b) =>
		a.localeCompare(b),
	);
	return { projectionType, nonKeyAttributes };
};

const normalizeThroughput = (
	throughput:
		| { ReadCapacityUnits?: number | undefined; WriteCapacityUnits?: number | undefined }
		| undefined,
): { read?: number | undefined; write?: number | undefined } => {
	return {
		read: throughput?.ReadCapacityUnits,
		write: throughput?.WriteCapacityUnits,
	};
};

const areGlobalSecondaryIndexesEquivalent = (props: {
	existing: GlobalSecondaryIndexDescription;
	desired: GlobalSecondaryIndex;
}): boolean => {
	const existingKeySchema = normalizeKeySchema(props.existing.KeySchema);
	const desiredKeySchema = normalizeKeySchema(props.desired.KeySchema);
	if (existingKeySchema.length !== desiredKeySchema.length) {
		return false;
	}
	for (const [index, entry] of existingKeySchema.entries()) {
		const desiredEntry = desiredKeySchema[index];
		if (!desiredEntry) {
			return false;
		}
		if (entry.attributeName !== desiredEntry.attributeName) {
			return false;
		}
		if (entry.keyType !== desiredEntry.keyType) {
			return false;
		}
	}

	const existingProjection = normalizeProjection(props.existing.Projection);
	const desiredProjection = normalizeProjection(props.desired.Projection);
	if (existingProjection.projectionType !== desiredProjection.projectionType) {
		return false;
	}
	if (existingProjection.nonKeyAttributes.length !== desiredProjection.nonKeyAttributes.length) {
		return false;
	}
	for (const [index, value] of existingProjection.nonKeyAttributes.entries()) {
		if (value !== desiredProjection.nonKeyAttributes[index]) {
			return false;
		}
	}

	const existingThroughput = normalizeThroughput(props.existing.ProvisionedThroughput);
	const desiredThroughput = normalizeThroughput(props.desired.ProvisionedThroughput);
	if (existingThroughput.read !== desiredThroughput.read) {
		return false;
	}
	if (existingThroughput.write !== desiredThroughput.write) {
		return false;
	}

	return true;
};

const resolveExistingGsi = (table: { GlobalSecondaryIndexes?: GlobalSecondaryIndexDescription[] | undefined }) => {
	const indexes = table.GlobalSecondaryIndexes ?? [];
	return indexes.reduce<Map<string, GlobalSecondaryIndexDescription>>((acc, index) => {
		acc.set(index.IndexName ?? "", index);
		return acc;
	}, new Map());
};

const resolveAttributeDefinitionMap = (props: {
	attributeDefinitions: AttributeDefinition[] | undefined;
}): Map<string, AttributeDefinition> => {
	const defs = props.attributeDefinitions ?? [];
	return defs.reduce<Map<string, AttributeDefinition>>((acc, def) => {
		if (!def.AttributeName) {
			return acc;
		}
		acc.set(def.AttributeName, def);
		return acc;
	}, new Map());
};

const resolveIndexKeyAttributeNames = (gsi: GlobalSecondaryIndex): string[] => {
	const keySchema = gsi.KeySchema ?? [];
	return keySchema
		.map((entry) => entry.AttributeName)
		.filter((name): name is string => typeof name === "string" && name.length > 0);
};

const resolveMissingAttributeDefinitions = (props: {
	existing: Map<string, AttributeDefinition>;
	desiredTableAttributeDefinitions: AttributeDefinition[];
	index: GlobalSecondaryIndex;
}): AttributeDefinition[] => {
	const desiredByName = resolveAttributeDefinitionMap({
		attributeDefinitions: props.desiredTableAttributeDefinitions,
	});
	const missing: AttributeDefinition[] = [];
	const requiredAttributeNames = resolveIndexKeyAttributeNames(props.index);

	for (const attributeName of requiredAttributeNames) {
		const existing = props.existing.get(attributeName);
		if (existing) {
			const desired = desiredByName.get(attributeName);
			if (desired) {
				if (desired.AttributeType) {
					if (existing.AttributeType) {
						if (desired.AttributeType !== existing.AttributeType) {
							throw new DynamoDBAdapterError(
								"ATTRIBUTE_DEFINITION_MISMATCH",
								`Attribute type mismatch for ${attributeName}: existing=${existing.AttributeType} desired=${desired.AttributeType}`,
							);
						}
					}
				}
			}
			continue;
		}
		const desired = desiredByName.get(attributeName);
		if (!desired) {
			throw new DynamoDBAdapterError(
				"MISSING_ATTRIBUTE_DEFINITION",
				`Missing AttributeDefinition for ${attributeName} required by GSI ${props.index.IndexName ?? "(unknown)"}.`,
			);
		}
		missing.push(desired);
	}

	return missing;
};

const waitForTableReady = async (props: {
	client: DynamoDBClient;
	tableName: string;
	wait: WaiterConfiguration;
	presentGsiNames?: string[] | undefined;
	absentGsiNames?: string[] | undefined;
}): Promise<void> => {
	const start = Date.now();
	const maxWaitMs = Math.max(0, (props.wait.maxWaitTime ?? 60) * 1000);
	const delayMs = Math.max(0, (props.wait.minDelay ?? 2) * 1000);
	const expectedPresent = props.presentGsiNames ?? [];
	const expectedAbsent = props.absentGsiNames ?? [];

	for (;;) {
		const table = await describeTable(props.client, props.tableName);
		const status = table.TableStatus ?? "";
		const gsiList = table.GlobalSecondaryIndexes ?? [];
		const gsiMap = gsiList.reduce<Map<string, string>>((acc, entry) => {
			const name = entry.IndexName ?? "";
			if (name.length === 0) {
				return acc;
			}
			acc.set(name, entry.IndexStatus ?? "");
			return acc;
		}, new Map());

		const hasAllPresent = expectedPresent.every((name) => gsiMap.get(name) === "ACTIVE");
		const hasAllAbsent = expectedAbsent.every((name) => !gsiMap.has(name));
		if (status !== "ACTIVE") {
			if (Date.now() - start > maxWaitMs) {
				throw new DynamoDBAdapterError(
					"TABLE_WAIT_TIMEOUT",
					`Timed out waiting for table ${props.tableName} to become ready.`,
				);
			}
			await sleep(delayMs);
			continue;
		}
		if (!hasAllPresent) {
			if (Date.now() - start > maxWaitMs) {
				throw new DynamoDBAdapterError(
					"TABLE_WAIT_TIMEOUT",
					`Timed out waiting for table ${props.tableName} to become ready.`,
				);
			}
			await sleep(delayMs);
			continue;
		}
			if (!hasAllAbsent) {
				if (Date.now() - start > maxWaitMs) {
					throw new DynamoDBAdapterError(
						"TABLE_WAIT_TIMEOUT",
					`Timed out waiting for table ${props.tableName} to become ready.`,
				);
			}
			await sleep(delayMs);
			continue;
			}
			return;
		}
	};

const deleteGlobalSecondaryIndex = async (props: {
	client: DynamoDBClient;
	tableName: string;
	indexName: string;
	wait: WaiterConfiguration;
}): Promise<void> => {
	await props.client.send(
		new UpdateTableCommand({
			TableName: props.tableName,
			GlobalSecondaryIndexUpdates: [
				{
					Delete: { IndexName: props.indexName },
				},
			],
		}),
	);
	await waitForTableReady({
		client: props.client,
		tableName: props.tableName,
		wait: props.wait,
		absentGsiNames: [props.indexName],
	});
};

const createGlobalSecondaryIndex = async (props: {
	client: DynamoDBClient;
	tableName: string;
	index: GlobalSecondaryIndex;
	existingAttributeDefinitions: AttributeDefinition[] | undefined;
	desiredTableAttributeDefinitions: AttributeDefinition[];
	wait: WaiterConfiguration;
}): Promise<void> => {
	const existingDefs = resolveAttributeDefinitionMap({
		attributeDefinitions: props.existingAttributeDefinitions,
	});
	const missingDefs = resolveMissingAttributeDefinitions({
		existing: existingDefs,
		desiredTableAttributeDefinitions: props.desiredTableAttributeDefinitions,
		index: props.index,
	});

	await props.client.send(
		new UpdateTableCommand({
			TableName: props.tableName,
			AttributeDefinitions: missingDefs.length > 0 ? missingDefs : undefined,
			GlobalSecondaryIndexUpdates: [
				{
					Create: {
						IndexName: props.index.IndexName,
						KeySchema: props.index.KeySchema,
						Projection: props.index.Projection,
						ProvisionedThroughput: props.index.ProvisionedThroughput,
					},
				},
			],
		}),
	);

	await waitForTableReady({
		client: props.client,
		tableName: props.tableName,
		wait: props.wait,
		presentGsiNames: [props.index.IndexName ?? ""].filter((name) => name.length > 0),
	});
};

export const applyTableSchemas = async (
	options: ApplyTableSchemasOptions,
): Promise<ApplyTableSchemasResult> => {
	if (!options.client) {
		throw new DynamoDBAdapterError(
			"MISSING_CLIENT",
			"DynamoDB applyTableSchemas requires a DynamoDBClient instance.",
		);
	}

	const waitConfig = options.wait ?? { maxWaitTime: 60, minDelay: 2 };
	const existingTables = await listTableNames(options.client);
	const createdTables: string[] = [];
	const updatedTables = new Set<string>();

	for (const table of options.tables) {
		const definition = table.tableDefinition;
		const desiredGsi = definition.globalSecondaryIndexes ?? [];

		if (!existingTables.includes(table.tableName)) {
			await options.client.send(
				new CreateTableCommand({
					TableName: table.tableName,
					AttributeDefinitions: definition.attributeDefinitions,
					KeySchema: definition.keySchema,
					BillingMode: definition.billingMode,
					GlobalSecondaryIndexes: definition.globalSecondaryIndexes,
				}),
			);
			await waitUntilTableExists(
				{ client: options.client, ...waitConfig },
				{ TableName: table.tableName },
			);
			createdTables.push(table.tableName);
			continue;
		}

		if (desiredGsi.length === 0) {
			continue;
		}

		const current = await describeTable(options.client, table.tableName);
		const existingGsiMap = resolveExistingGsi(current);

		for (const desiredIndex of desiredGsi) {
			const indexName = desiredIndex.IndexName ?? "";
			if (indexName.length === 0) {
				continue;
			}
			const existingIndex = existingGsiMap.get(indexName);
			if (!existingIndex) {
				await createGlobalSecondaryIndex({
					client: options.client,
					tableName: table.tableName,
					index: desiredIndex,
					existingAttributeDefinitions: current.AttributeDefinitions,
					desiredTableAttributeDefinitions: definition.attributeDefinitions,
					wait: waitConfig,
				});
				updatedTables.add(table.tableName);
				continue;
			}

			const matches = areGlobalSecondaryIndexesEquivalent({
				existing: existingIndex,
				desired: desiredIndex,
			});
			if (matches) {
				continue;
			}

			await deleteGlobalSecondaryIndex({
				client: options.client,
				tableName: table.tableName,
				indexName,
				wait: waitConfig,
			});
			const refreshed = await describeTable(options.client, table.tableName);
			await createGlobalSecondaryIndex({
				client: options.client,
				tableName: table.tableName,
				index: desiredIndex,
				existingAttributeDefinitions: refreshed.AttributeDefinitions,
				desiredTableAttributeDefinitions: definition.attributeDefinitions,
				wait: waitConfig,
			});
			updatedTables.add(table.tableName);
		}
	}

	return {
		createdTables,
		updatedTables: Array.from(updatedTables.values()),
	};
};
