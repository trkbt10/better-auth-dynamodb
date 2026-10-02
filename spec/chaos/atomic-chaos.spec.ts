/**
 * @file Chaos specs for the atomic methods (consumeOne / incrementOne).
 *
 * Concurrent callers race for single-use rows and guarded counters while the
 * cluster answers their requests in a random order, serves index reads from
 * lagging replicas and fails requests. Whatever happens, the invariants of
 * the two methods have to hold for every write the cluster applied.
 */
import {
	CHAOS_PROFILES,
	describeFailure,
	expectChaosHappened,
	runChaos,
	type ChaosEnvironment,
} from "./chaos-harness";
import type { ChaosWrite } from "./chaos-cluster";

type VerificationRow = { id: string; identifier: string; value: string };

type UserRow = { id: string; email: string; name: string; loginCount?: number | null };

type TokenOperation =
	| { kind: "byId"; id: string; identifier: string; exclusive: boolean }
	| { kind: "byIdentifier"; identifier: string; exclusive: boolean }
	| { kind: "guarded"; identifier: string; exclusive: false }
	| { kind: "mutate"; id: string; identifier: string; exclusive: false };

const hadNoFaults = (environment: ChaosEnvironment, task: number): boolean => {
	const faults = environment.cluster.faultsOf(task);
	return faults.rejected + faults.lostResponses + faults.transactionConflicts === 0;
};

const describeTokenOperation = (operation: TokenOperation, task: number): string => {
	if (operation.kind === "byId" || operation.kind === "mutate") {
		return `task ${task} (${operation.kind} ${operation.id})`;
	}
	return `task ${task} (${operation.kind} ${operation.identifier})`;
};

// The where clause of a consume, checked against the row DynamoDB deleted.
const matchesTokenOperation = (operation: TokenOperation, row: Record<string, unknown>): boolean => {
	if (operation.kind === "byId") {
		return row.id === operation.id;
	}
	if (operation.kind === "byIdentifier") {
		return row.identifier === operation.identifier;
	}
	if (operation.kind === "guarded") {
		return row.identifier === operation.identifier && row.value === "v";
	}
	return false;
};

const singleUseRowsScenario = async (environment: ChaosEnvironment): Promise<string[]> => {
	const { cluster } = environment;
	const { random } = cluster;
	const adapter = environment.createAdapter();
	const table = environment.tableName("verification");

	const createRow = (identifier: string): Promise<VerificationRow> =>
		adapter.create<Record<string, unknown>, VerificationRow>({
			model: "verification",
			data: { identifier, value: "v", expiresAt: new Date("2100-01-01T00:00:00.000Z") },
		});

	const shared: VerificationRow[] = [];
	for (const identifier of ["shared-a", "shared-b"]) {
		const count = 1 + random.int(3);
		for (let index = 0; index < count; index += 1) {
			shared.push(await createRow(identifier));
		}
	}
	const soloById = await createRow("solo-by-id");
	await createRow("solo-by-identifier");
	cluster.settle();

	const createSharedOperation = (): TokenOperation => {
		const row = random.pick(shared);
		const kind = random.pick(["byId", "byIdentifier", "guarded", "mutate"] as const);
		if (kind === "byId") {
			return { kind, id: row.id, identifier: row.identifier, exclusive: false };
		}
		if (kind === "mutate") {
			return { kind, id: row.id, identifier: row.identifier, exclusive: false };
		}
		if (kind === "guarded") {
			return { kind, identifier: row.identifier, exclusive: false };
		}
		return { kind, identifier: row.identifier, exclusive: false };
	};
	const operations: TokenOperation[] = [
		// Nobody else touches these two rows: their consumer has to get them.
		{ kind: "byId", id: soloById.id, identifier: soloById.identifier, exclusive: true },
		{ kind: "byIdentifier", identifier: "solo-by-identifier", exclusive: true },
		...Array.from({ length: 6 + random.int(6) }, createSharedOperation),
	];

	const perform = (operation: TokenOperation): Promise<VerificationRow | null> => {
		if (operation.kind === "byId") {
			return adapter.consumeOne<VerificationRow>({
				model: "verification",
				where: [{ field: "id", value: operation.id }],
			});
		}
		if (operation.kind === "byIdentifier") {
			return adapter.consumeOne<VerificationRow>({
				model: "verification",
				where: [{ field: "identifier", value: operation.identifier }],
			});
		}
		if (operation.kind === "guarded") {
			return adapter.consumeOne<VerificationRow>({
				model: "verification",
				where: [
					{ field: "identifier", value: operation.identifier },
					{ field: "value", value: "v" },
				],
			});
		}
		return adapter.update<VerificationRow>({
			model: "verification",
			where: [{ field: "id", value: operation.id }],
			update: { value: "changed" },
		});
	};

	const results = await cluster.run(operations.map((operation) => () => perform(operation)));

	const violations: string[] = [];
	const handedOut: string[] = [];
	operations.forEach((operation, task) => {
		const label = describeTokenOperation(operation, task);
		const result = results[task];
		const lostResponses = cluster.faultsOf(task).lostResponses;
		if (result.status === "rejected" && !environment.isExpectedFailure(result.reason)) {
			violations.push(`${label} failed unexpectedly: ${describeFailure(result.reason)}`);
		}
		if (operation.kind === "mutate") {
			return;
		}
		const deletes = cluster.writes.filter(
			(write) => write.task === task && write.tableName === table && write.next === undefined,
		);
		if (deletes.length > 1 + lostResponses) {
			violations.push(`${label} deleted ${deletes.length} rows`);
		}
		deletes.forEach((write) => {
			if (!matchesTokenOperation(operation, write.previous ?? {})) {
				violations.push(`${label} deleted a row that did not match: ${JSON.stringify(write.previous)}`);
			}
		});
		const acknowledged = result.status === "fulfilled" ? result.value : null;
		if (acknowledged) {
			handedOut.push(acknowledged.id);
			const own = deletes.find((write) => write.previous?.id === acknowledged.id);
			if (!own) {
				violations.push(`${label} returned row ${acknowledged.id} without deleting it`);
			} else if (own.previous?.value !== acknowledged.value) {
				violations.push(`${label} returned a row that differs from the one it deleted`);
			}
		}
		const unreported = deletes.filter((write) => write.previous?.id !== acknowledged?.id);
		if (unreported.length > lostResponses) {
			violations.push(`${label} deleted ${unreported.length} row(s) it did not hand back`);
		}
		const missedOwnRow = operation.exclusive ? !acknowledged : false;
		if (missedOwnRow && hadNoFaults(environment, task)) {
			violations.push(`${label} did not get the row only it was after`);
		}
	});

	if (new Set(handedOut).size !== handedOut.length) {
		violations.push(`a row was handed out twice: ${handedOut.join(", ")}`);
	}
	const remaining = cluster.store.get(table);
	handedOut.forEach((id) => {
		if (remaining.some((row) => row.id === id)) {
			violations.push(`row ${id} was handed out but is still stored`);
		}
	});
	remaining.forEach((row) => {
		if (row.identifier === undefined || row.value === undefined || row.expiresAt === undefined) {
			violations.push(`a stored row lost attributes: ${JSON.stringify(row)}`);
		}
	});
	return violations;
};

type CounterOperation =
	| { kind: "guardedById"; delta: number }
	| { kind: "guardedByEmail"; delta: number }
	| { kind: "unguardedByEmail"; delta: number }
	| { kind: "release"; delta: number };

const counterValue = (row: Record<string, unknown> | undefined): number => {
	const value = row?.loginCount;
	return typeof value === "number" ? value : 0;
};

const guardedCounterScenario = async (environment: ChaosEnvironment): Promise<string[]> => {
	const { cluster } = environment;
	const { random } = cluster;
	const adapter = environment.createAdapter();
	const table = environment.tableName("user");
	const email = "counter@example.com";
	const limit = 3 + random.int(5);

	// The counter starts as a number, as NULL, or without the attribute.
	const initial = random.pick(["zero", "null", "absent"] as const);
	const user = await adapter.create<Record<string, unknown>, UserRow>({
		model: "user",
		data: { name: "counter", email, ...(initial === "zero" ? { loginCount: 0 } : {}) },
	});
	if (initial === "null") {
		cluster.store.updateByKey(table, { id: user.id }, { loginCount: null });
	}
	cluster.settle();

	const operations: CounterOperation[] = Array.from({ length: 6 + random.int(8) }, () => {
		const kind = random.pick(["guardedById", "guardedByEmail", "unguardedByEmail", "release"] as const);
		if (kind === "release") {
			return { kind, delta: -1 };
		}
		return { kind, delta: 1 + random.int(2) };
	});

	const perform = (operation: CounterOperation): Promise<UserRow | null> => {
		const increment = { loginCount: operation.delta };
		if (operation.kind === "guardedById") {
			return adapter.incrementOne<UserRow>({
				model: "user",
				where: [
					{ field: "id", value: user.id },
					{ field: "loginCount", operator: "lt", value: limit },
				],
				increment,
			});
		}
		if (operation.kind === "guardedByEmail") {
			return adapter.incrementOne<UserRow>({
				model: "user",
				where: [
					{ field: "email", value: email },
					{ field: "loginCount", operator: "lt", value: limit },
				],
				increment,
			});
		}
		if (operation.kind === "release") {
			return adapter.incrementOne<UserRow>({
				model: "user",
				where: [
					{ field: "id", value: user.id },
					{ field: "loginCount", operator: "gte", value: 1 },
				],
				increment,
			});
		}
		return adapter.incrementOne<UserRow>({
			model: "user",
			where: [{ field: "email", value: email }],
			increment,
		});
	};

	const results = await cluster.run(operations.map((operation) => () => perform(operation)));

	const violations: string[] = [];
	// A counter that starts as NULL or absent never satisfies `lt` / `gte`, so
	// a guarded write may only follow an unguarded one that made it a number.
	const guardHeld = (operation: CounterOperation, write: ChaosWrite): boolean => {
		const before = write.previous?.loginCount;
		if (operation.kind === "unguardedByEmail") {
			return true;
		}
		if (typeof before !== "number") {
			return false;
		}
		if (operation.kind === "release") {
			return before >= 1;
		}
		return before < limit;
	};

	operations.forEach((operation, task) => {
		const label = `task ${task} (${operation.kind} ${operation.delta})`;
		const result = results[task];
		const lostResponses = cluster.faultsOf(task).lostResponses;
		if (result.status === "rejected" && !environment.isExpectedFailure(result.reason)) {
			violations.push(`${label} failed unexpectedly: ${describeFailure(result.reason)}`);
		}
		const writes = cluster.writes.filter(
			(write) => write.task === task && write.tableName === table,
		);
		if (writes.length > 1 + lostResponses) {
			violations.push(`${label} wrote ${writes.length} times`);
		}
		writes.forEach((write) => {
			if (!write.previous || !write.next) {
				violations.push(`${label} created or deleted the row`);
				return;
			}
			if (counterValue(write.next) - counterValue(write.previous) !== operation.delta) {
				violations.push(
					`${label} moved the counter from ${counterValue(write.previous)} to ${counterValue(write.next)}`,
				);
			}
			if (!guardHeld(operation, write)) {
				violations.push(`${label} wrote although its guard did not hold (${String(write.previous.loginCount)})`);
			}
			if (write.next.email !== email || write.next.name !== "counter") {
				violations.push(`${label} changed attributes it did not assign`);
			}
		});
		const acknowledged = result.status === "fulfilled" ? result.value : null;
		if (acknowledged) {
			const last = writes[writes.length - 1];
			if (!last) {
				violations.push(`${label} returned a row without writing`);
			} else if (acknowledged.loginCount !== last.next?.loginCount) {
				violations.push(
					`${label} returned ${String(acknowledged.loginCount)} but wrote ${String(last.next?.loginCount)}`,
				);
			}
		}
		if (!acknowledged && writes.length > lostResponses) {
			violations.push(`${label} wrote without reporting it`);
		}
		const alwaysMatches = operation.kind === "unguardedByEmail";
		const foundNothing = result.status === "fulfilled" ? !acknowledged : false;
		const missedRow = alwaysMatches ? foundNothing : false;
		if (missedRow && hadNoFaults(environment, task)) {
			violations.push(`${label} found no row although its where clause always matches`);
		}
	});

	const applied = cluster.writes.filter((write) => write.task !== undefined && write.tableName === table);
	const expected = applied.reduce(
		(total, write) => total + counterValue(write.next) - counterValue(write.previous),
		0,
	);
	const stored = cluster.store.findByKey(table, { id: user.id });
	if (counterValue(stored) !== expected) {
		violations.push(`the counter holds ${counterValue(stored)}, the applied writes add up to ${expected}`);
	}
	return violations;
};

describe("chaos: single-use rows are handed out at most once", () => {
	for (const profile of CHAOS_PROFILES) {
		test(profile.name, async () => {
			const totals = await runChaos({ profile, scenario: singleUseRowsScenario });
			expect(expectChaosHappened(profile, totals)).toEqual([]);
		});
	}
});

describe("chaos: guarded counters neither lose nor exceed", () => {
	for (const profile of CHAOS_PROFILES) {
		test(profile.name, async () => {
			const totals = await runChaos({ profile, scenario: guardedCounterScenario });
			expect(expectChaosHappened(profile, totals)).toEqual([]);
		});
	}
});
