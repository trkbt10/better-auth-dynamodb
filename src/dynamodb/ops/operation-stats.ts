/**
 * @file Collect per-execution DynamoDB operation statistics.
 */
export type DynamoDBOperationCounts = {
	scanCommands: number;
	queryCommands: number;
	batchGetCommands: number;
};

export type DynamoDBScanStats = {
	commands: number;
	items: number;
};

export type DynamoDBQueryStats = {
	commands: number;
	items: number;
};

export type DynamoDBBatchGetStats = {
	commands: number;
	keys: number;
	retries: number;
	items: number;
};

export type DynamoDBOperationStatsSnapshot = {
	totals: DynamoDBOperationCounts;
	scans: Record<string, DynamoDBScanStats>;
	queries: Record<string, DynamoDBQueryStats>;
	batchGets: Record<string, DynamoDBBatchGetStats>;
};

export type DynamoDBOperationStatsCollector = {
	recordScan: (props: { tableName: string; items: number }) => void;
	recordQuery: (props: { tableName: string; items: number }) => void;
	recordBatchGet: (props: {
		tableName: string;
		keys: number;
		items: number;
		isRetry: boolean;
	}) => void;
	snapshot: () => DynamoDBOperationStatsSnapshot;
};

const bumpByTable = <T extends { commands: number }>(
	record: Record<string, T>,
	props: { tableName: string; makeInitial: () => T },
): T => {
	const existing = record[props.tableName];
	if (existing) {
		return existing;
	}
	const created = props.makeInitial();
	record[props.tableName] = created;
	return created;
};

export const createDynamoDBOperationStatsCollector =
	(): DynamoDBOperationStatsCollector => {
		const state: DynamoDBOperationStatsSnapshot = {
			totals: {
				scanCommands: 0,
				queryCommands: 0,
				batchGetCommands: 0,
			},
			scans: {},
			queries: {},
			batchGets: {},
		};

		return {
			recordScan: (props) => {
				state.totals.scanCommands += 1;
				const entry = bumpByTable(state.scans, {
					tableName: props.tableName,
					makeInitial: () => ({ commands: 0, items: 0 }),
				});
				entry.commands += 1;
				entry.items += props.items;
			},
			recordQuery: (props) => {
				state.totals.queryCommands += 1;
				const entry = bumpByTable(state.queries, {
					tableName: props.tableName,
					makeInitial: () => ({ commands: 0, items: 0 }),
				});
				entry.commands += 1;
				entry.items += props.items;
			},
			recordBatchGet: (props) => {
				state.totals.batchGetCommands += 1;
				const entry = bumpByTable(state.batchGets, {
					tableName: props.tableName,
					makeInitial: () => ({ commands: 0, keys: 0, retries: 0, items: 0 }),
				});
				entry.commands += 1;
				entry.keys += props.keys;
				entry.items += props.items;
				if (props.isRetry) {
					entry.retries += 1;
				}
			},
			snapshot: () => state,
		};
	};

const sortedKeys = (record: Record<string, unknown>): string[] =>
	Object.keys(record).sort((a, b) => a.localeCompare(b));

export const formatDynamoDBOperationStats = (
	stats: DynamoDBOperationStatsSnapshot,
): string => {
	const lines: string[] = [];
	lines.push("ACTUAL");
	lines.push(
		`  commands: ScanCommand=${stats.totals.scanCommands} QueryCommand=${stats.totals.queryCommands} BatchGetCommand=${stats.totals.batchGetCommands}`,
	);

	for (const tableName of sortedKeys(stats.scans)) {
		const entry = stats.scans[tableName];
		lines.push(
			`  SCAN table=${tableName} commands=${entry.commands} items=${entry.items}`,
		);
	}

	for (const tableName of sortedKeys(stats.queries)) {
		const entry = stats.queries[tableName];
		lines.push(
			`  QUERY table=${tableName} commands=${entry.commands} items=${entry.items}`,
		);
	}

	for (const tableName of sortedKeys(stats.batchGets)) {
		const entry = stats.batchGets[tableName];
		lines.push(
			`  BATCH-GET table=${tableName} commands=${entry.commands} keys=${entry.keys} retries=${entry.retries} items=${entry.items}`,
		);
	}

	return lines.join("\n");
};

