/**
 * @file Tests for the chaos tooling itself: the replication lag of the fake,
 * the seeded scheduler and the fault injection. A chaos spec only means
 * something if the cluster really misbehaves the way it claims to.
 */
import {
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	TransactWriteCommand,
	UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { generateTableSchemas } from "../../src/table-schemas";
import {
	createStatefulDocumentClient,
	type AppliedWrite,
} from "../stateful-document-client";
import { createChaosCluster, NO_FAULTS, type ChaosFaults } from "./chaos-cluster";
import { createSeededRandom } from "./seeded-random";

const schemas = generateTableSchemas({});
const prefix = "tooling_";
const userTable = `${prefix}user`;

const byEmail = (email: string) =>
	new QueryCommand({
		TableName: userTable,
		IndexName: "user_email_idx",
		KeyConditionExpression: "#e = :e",
		ExpressionAttributeNames: { "#e": "email" },
		ExpressionAttributeValues: { ":e": email },
	});

describe("seeded random", () => {
	test("repeats its sequence for a seed and differs between seeds", () => {
		const draw = (seed: number) => {
			const random = createSeededRandom(seed);
			return Array.from({ length: 8 }, () => random.int(1000));
		};

		expect(draw(42)).toEqual(draw(42));
		expect(draw(42)).not.toEqual(draw(43));
		expect(draw(42).every((value) => value >= 0 && value < 1000)).toBe(true);
	});
});

describe("replication lag of the fake", () => {
	const createLaggingFake = (lag: number) => {
		const writes: AppliedWrite[] = [];
		const fake = createStatefulDocumentClient({
			tableSchemas: schemas,
			tableNamePrefix: prefix,
			replication: { historySize: 4, resolveItemLag: () => lag },
			onWrite: (write) => writes.push(write),
		});
		return { ...fake, writes };
	};

	test("answers index and plain reads from an earlier state, consistent reads from the current one", async () => {
		const { documentClient, store, settleReplication } = createLaggingFake(1);
		store.put(userTable, { id: "u1", email: "a@example.com", name: "before" });
		settleReplication();
		await documentClient.send(
			new UpdateCommand({
				TableName: userTable,
				Key: { id: "u1" },
				UpdateExpression: "SET #n = :n",
				ExpressionAttributeNames: { "#n": "name" },
				ExpressionAttributeValues: { ":n": "after" },
			}),
		);

		const indexed = await documentClient.send(byEmail("a@example.com"));
		const scanned = await documentClient.send(new ScanCommand({ TableName: userTable }));
		const plain = await documentClient.send(new GetCommand({ TableName: userTable, Key: { id: "u1" } }));
		const consistent = await documentClient.send(
			new GetCommand({ TableName: userTable, Key: { id: "u1" }, ConsistentRead: true }),
		);
		const consistentScan = await documentClient.send(
			new ScanCommand({ TableName: userTable, ConsistentRead: true }),
		);

		expect(indexed.Items?.[0]?.name).toBe("before");
		expect(scanned.Items?.[0]?.name).toBe("before");
		expect(plain.Item?.name).toBe("before");
		expect(consistent.Item?.name).toBe("after");
		expect(consistentScan.Items?.[0]?.name).toBe("after");
	});

	test("still lists a deleted row and does not list a new one yet", async () => {
		const { documentClient, store, settleReplication } = createLaggingFake(2);
		store.put(userTable, { id: "old", email: "old@example.com" });
		settleReplication();
		store.deleteByKey(userTable, { id: "old" });
		await documentClient.send(
			new PutCommand({ TableName: userTable, Item: { id: "new", email: "new@example.com" } }),
		);

		// Two writes behind: neither the delete nor the put has arrived.
		expect((await documentClient.send(byEmail("old@example.com"))).Items).toHaveLength(1);
		expect((await documentClient.send(byEmail("new@example.com"))).Items).toEqual([]);
		settleReplication();
		expect((await documentClient.send(byEmail("old@example.com"))).Items).toEqual([]);
		expect((await documentClient.send(byEmail("new@example.com"))).Items).toHaveLength(1);
	});

	test("lets items lag independently", async () => {
		// The first row is one write behind, the second one is current.
		const fake = createStatefulDocumentClient({
			tableSchemas: schemas,
			tableNamePrefix: prefix,
			replication: {
				historySize: 4,
				resolveItemLag: (_read, itemKey) => (itemKey.includes("u1") ? 1 : 0),
			},
		});
		fake.store.put(userTable, { id: "u1", name: "v0" });
		fake.store.put(userTable, { id: "u2", name: "v0" });
		fake.settleReplication();
		fake.store.updateByKey(userTable, { id: "u2" }, { name: "v1" });
		fake.store.updateByKey(userTable, { id: "u1" }, { name: "v1" });

		const scanned = await fake.documentClient.send(new ScanCommand({ TableName: userTable }));
		const names = (scanned.Items ?? []).map((item) => `${String(item.id)}=${String(item.name)}`).sort();

		// A combination the table never held: the read is fractured.
		expect(names).toEqual(["u1=v0", "u2=v1"]);
	});

	test("shows a transaction as one step and reports every applied write", async () => {
		const { documentClient, store, settleReplication, writes } = createLaggingFake(1);
		store.put(userTable, { id: "a", balance: 1 });
		store.put(userTable, { id: "b", balance: 1 });
		settleReplication();
		await documentClient.send(
			new TransactWriteCommand({
				TransactItems: [
					{ Put: { TableName: userTable, Item: { id: "a", balance: 0 } } },
					{ Put: { TableName: userTable, Item: { id: "b", balance: 2 } } },
				],
			}),
		);

		const stale = await documentClient.send(new ScanCommand({ TableName: userTable }));
		const current = await documentClient.send(new ScanCommand({ TableName: userTable, ConsistentRead: true }));

		// One step behind the transaction is the state before all of it.
		expect(stale.Items?.map((item) => item.balance)).toEqual([1, 1]);
		expect(current.Items?.map((item) => item.balance)).toEqual([0, 2]);
		expect(writes).toEqual([
			{ tableName: userTable, previous: { id: "a", balance: 1 }, next: { id: "a", balance: 0 } },
			{ tableName: userTable, previous: { id: "b", balance: 1 }, next: { id: "b", balance: 2 } },
		]);
	});
});

describe("chaos cluster", () => {
	const createCluster = (seed: number, faults: Partial<ChaosFaults> = {}) =>
		createChaosCluster({
			seed,
			faults: { ...NO_FAULTS, ...faults },
			tableSchemas: schemas,
			tableNamePrefix: prefix,
		});

	const put = (id: string) => new PutCommand({ TableName: userTable, Item: { id } });

	const runPuts = async (seed: number, faults: Partial<ChaosFaults> = {}) => {
		const cluster = createCluster(seed, faults);
		const results = await cluster.run(
			Array.from({ length: 6 }, (_, index) => async () => {
				await cluster.documentClient.send(put(`first-${index}`));
				await cluster.documentClient.send(put(`second-${index}`));
				return index;
			}),
		);
		return { cluster, results };
	};

	test("answers requests in an order that only depends on the seed", async () => {
		const first = await runPuts(7);
		const again = await runPuts(7);
		const other = await runPuts(8);

		expect(first.cluster.trace).toEqual(again.cluster.trace);
		expect(first.cluster.trace).not.toEqual(other.cluster.trace);
		expect(first.cluster.trace).toHaveLength(12);
		expect(first.results.every((result) => result.status === "fulfilled")).toBe(true);
		expect(first.cluster.store.get(userTable)).toHaveLength(12);
	});

	test("attributes every applied write to its task", async () => {
		const { cluster } = await runPuts(3);

		expect(cluster.writes).toHaveLength(12);
		[0, 1, 2, 3, 4, 5].forEach((task) => {
			const ids = cluster.writes.filter((write) => write.task === task).map((write) => write.next?.id);
			expect(ids).toEqual([`first-${task}`, `second-${task}`]);
		});
	});

	test("rejects requests before they are applied", async () => {
		const { cluster, results } = await runPuts(5, { rejectRate: 1 });

		expect(results.every((result) => result.status === "rejected")).toBe(true);
		expect(results[0]).toMatchObject({
			reason: { name: "ProvisionedThroughputExceededException" },
		});
		expect(cluster.store.get(userTable)).toHaveLength(0);
		expect(cluster.statistics()).toMatchObject({ rejected: 6 });
	});

	test("applies a write and loses its response", async () => {
		const { cluster, results } = await runPuts(5, { lostResponseRate: 1 });

		expect(results.every((result) => result.status === "rejected")).toBe(true);
		expect(results[0]).toMatchObject({ reason: { name: "TimeoutError" } });
		expect(cluster.store.get(userTable).map((row) => String(row.id)).sort()).toEqual(
			[0, 1, 2, 3, 4, 5].map((index) => `first-${index}`),
		);
		expect(cluster.faultsOf(0)).toMatchObject({ lostResponses: 1, resent: 0 });
	});

	test("re-sends a request whose response was lost", async () => {
		const cluster = createCluster(5, { lostResponseRate: 1, resendLostRequests: true });
		const guardedPut = new PutCommand({
			TableName: userTable,
			Item: { id: "once" },
			ConditionExpression: "attribute_not_exists(#pk)",
			ExpressionAttributeNames: { "#pk": "id" },
		});

		const [result] = await cluster.run([() => cluster.documentClient.send(guardedPut)]);

		// The first delivery created the row, the second one found it there.
		expect(result).toMatchObject({
			status: "rejected",
			reason: { name: "ConditionalCheckFailedException" },
		});
		expect(cluster.store.get(userTable)).toHaveLength(1);
		expect(cluster.faultsOf(0)).toMatchObject({ lostResponses: 1, resent: 1 });
	});

	test("cancels a transaction before it is applied", async () => {
		const cluster = createCluster(5, { transactionConflictRate: 1 });

		const [result] = await cluster.run([
			() =>
				cluster.documentClient.send(
					new TransactWriteCommand({
						TransactItems: [{ Put: { TableName: userTable, Item: { id: "tx" } } }],
					}),
				),
		]);

		expect(result).toMatchObject({
			status: "rejected",
			reason: { name: "TransactionCanceledException" },
		});
		expect(cluster.store.get(userTable)).toHaveLength(0);
	});

	test("serves stale index reads only when asked to, and counts them", async () => {
		const read = async (faults: Partial<ChaosFaults>) => {
			const cluster = createCluster(11, faults);
			cluster.store.put(userTable, { id: "u1", email: "a@example.com", name: "before" });
			cluster.settle();
			cluster.store.updateByKey(userTable, { id: "u1" }, { name: "after" });
			const [result] = await cluster.run([
				async () => (await cluster.documentClient.send(byEmail("a@example.com"))).Items?.[0]?.name,
			]);
			return { result, statistics: cluster.statistics() };
		};

		const fresh = await read({});
		const stale = await read({ staleReadRate: 1, maxLag: 1, fracturedReads: false });

		expect(fresh.result).toMatchObject({ status: "fulfilled", value: "after" });
		expect(fresh.statistics.staleReads).toBe(0);
		expect(stale.statistics.staleReads).toBe(1);
		expect(["before", "after"]).toContain(
			stale.result.status === "fulfilled" ? stale.result.value : undefined,
		);
	});

	test("answers requests outside a run at once and without faults", async () => {
		const cluster = createCluster(1, { rejectRate: 1 });

		await cluster.documentClient.send(put("setup"));

		expect(cluster.store.get(userTable)).toHaveLength(1);
		expect(cluster.trace).toEqual([]);
	});
});
