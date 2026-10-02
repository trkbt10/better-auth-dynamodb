/**
 * @file Tests for the DynamoDB operation statistics collector.
 */
import {
	createDynamoDBOperationStatsCollector,
	formatDynamoDBOperationStats,
} from "./operation-stats";

describe("createDynamoDBOperationStatsCollector", () => {
	test("starts empty", () => {
		const collector = createDynamoDBOperationStatsCollector();

		expect(collector.snapshot()).toEqual({
			totals: { scanCommands: 0, queryCommands: 0, batchGetCommands: 0 },
			scans: {},
			queries: {},
			batchGets: {},
		});
	});

	test("accumulates commands and items per table", () => {
		const collector = createDynamoDBOperationStatsCollector();

		collector.recordScan({ tableName: "user", items: 2 });
		collector.recordScan({ tableName: "user", items: 3 });
		collector.recordQuery({ tableName: "session", items: 1 });
		collector.recordQuery({ tableName: "account", items: 4 });
		collector.recordBatchGet({
			tableName: "user",
			keys: 100,
			items: 90,
			isRetry: false,
		});
		collector.recordBatchGet({
			tableName: "user",
			keys: 10,
			items: 10,
			isRetry: true,
		});

		expect(collector.snapshot()).toEqual({
			totals: { scanCommands: 2, queryCommands: 2, batchGetCommands: 2 },
			scans: { user: { commands: 2, items: 5 } },
			queries: {
				session: { commands: 1, items: 1 },
				account: { commands: 1, items: 4 },
			},
			batchGets: {
				user: { commands: 2, keys: 110, retries: 1, items: 100 },
			},
		});
	});
});

describe("formatDynamoDBOperationStats", () => {
	test("prints only the totals when nothing was recorded", () => {
		const collector = createDynamoDBOperationStatsCollector();

		expect(formatDynamoDBOperationStats(collector.snapshot())).toBe(
			[
				"ACTUAL",
				"  commands: ScanCommand=0 QueryCommand=0 BatchGetCommand=0",
			].join("\n"),
		);
	});

	test("prints one line per table, sorted by table name", () => {
		const collector = createDynamoDBOperationStatsCollector();
		collector.recordScan({ tableName: "user", items: 2 });
		collector.recordQuery({ tableName: "session", items: 1 });
		collector.recordQuery({ tableName: "account", items: 4 });
		collector.recordBatchGet({
			tableName: "user",
			keys: 3,
			items: 3,
			isRetry: true,
		});

		expect(formatDynamoDBOperationStats(collector.snapshot())).toBe(
			[
				"ACTUAL",
				"  commands: ScanCommand=1 QueryCommand=2 BatchGetCommand=1",
				"  SCAN table=user commands=1 items=2",
				"  QUERY table=account commands=1 items=4",
				"  QUERY table=session commands=1 items=1",
				"  BATCH-GET table=user commands=1 keys=3 retries=1 items=3",
			].join("\n"),
		);
	});
});
