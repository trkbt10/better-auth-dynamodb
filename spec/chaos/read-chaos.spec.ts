/**
 * @file Chaos specs for reads (findMany / count / findOne).
 *
 * Readers list a fixed set of rows while writers keep changing other rows of
 * the same table. Pages are cut short, batches come back partial, and index
 * reads lag, but the rows the readers ask for never change, so every answer
 * has to be exact: each row once, in the requested order, none missing.
 */
import {
	CHAOS_PROFILES,
	describeFailure,
	expectChaosHappened,
	runChaos,
	type ChaosEnvironment,
} from "./chaos-harness";

type UserRow = { id: string; name: string; email: string; loginCount?: number | null };

type ReadOperation =
	| { kind: "list" }
	| { kind: "count" }
	| { kind: "page"; limit: number; offset: number; direction: "asc" | "desc" }
	| { kind: "byIds"; ids: string[] }
	| { kind: "byId"; id: string }
	| { kind: "noise"; id: string };

const stableReadsScenario = async (environment: ChaosEnvironment): Promise<string[]> => {
	const { cluster } = environment;
	const { random } = cluster;
	const adapter = environment.createAdapter();
	const size = 8 + random.int(10);

	// `name` has no index: listing the group is a filtered scan.
	const group: UserRow[] = [];
	for (let index = 0; index < size; index += 1) {
		group.push(
			await adapter.create<Record<string, unknown>, UserRow>({
				model: "user",
				data: {
					id: `stable-${String(index).padStart(2, "0")}`,
					name: "stable",
					email: `stable-${index}@example.com`,
					loginCount: index,
				},
				forceAllowId: true,
			}),
		);
	}
	const noise: UserRow[] = [];
	for (let index = 0; index < 6; index += 1) {
		noise.push(
			await adapter.create<Record<string, unknown>, UserRow>({
				model: "user",
				data: { name: "noise", email: `noise-${index}@example.com`, loginCount: 0 },
			}),
		);
	}
	cluster.settle();

	const ids = group.map((row) => row.id);
	const operations: ReadOperation[] = Array.from({ length: 10 + random.int(8) }, () => {
		const kind = random.pick(["list", "count", "page", "byIds", "byId", "noise", "noise"] as const);
		if (kind === "page") {
			return {
				kind,
				limit: 1 + random.int(5),
				offset: random.int(size),
				direction: random.pick(["asc", "desc"] as const),
			};
		}
		if (kind === "byIds") {
			// Some ids are listed twice: a row still has to come back once.
			const chosen = ids.filter(() => random.chance(0.5));
			return { kind, ids: [...chosen, ...chosen.filter(() => random.chance(0.3))] };
		}
		if (kind === "byId") {
			return { kind, id: random.pick(ids) };
		}
		if (kind === "noise") {
			return { kind, id: random.pick(noise).id };
		}
		return { kind };
	});

	const where = [{ field: "name", value: "stable" }];
	const perform = async (operation: ReadOperation): Promise<unknown> => {
		if (operation.kind === "list") {
			const rows = await adapter.findMany<UserRow>({ model: "user", where });
			return rows.map((row) => row.id).sort();
		}
		if (operation.kind === "count") {
			return adapter.count({ model: "user", where });
		}
		if (operation.kind === "page") {
			const rows = await adapter.findMany<UserRow>({
				model: "user",
				where,
				sortBy: { field: "loginCount", direction: operation.direction },
				limit: operation.limit,
				offset: operation.offset,
			});
			return rows.map((row) => row.id);
		}
		if (operation.kind === "byIds") {
			if (operation.ids.length === 0) {
				return [];
			}
			const rows = await adapter.findMany<UserRow>({
				model: "user",
				where: [{ field: "id", operator: "in", value: operation.ids }],
			});
			return rows.map((row) => row.id).sort();
		}
		if (operation.kind === "byId") {
			const row = await adapter.findOne<UserRow>({
				model: "user",
				where: [{ field: "id", value: operation.id }],
			});
			return row?.email;
		}
		// Writers keep the table (and its replicas) moving under the readers.
		await adapter.incrementOne({
			model: "user",
			where: [{ field: "id", value: operation.id }],
			increment: { loginCount: 1 },
		});
		return undefined;
	};

	const expected = (operation: ReadOperation): unknown => {
		if (operation.kind === "list") {
			return [...ids].sort();
		}
		if (operation.kind === "count") {
			return size;
		}
		if (operation.kind === "page") {
			const ordered = operation.direction === "asc" ? ids : [...ids].reverse();
			return ordered.slice(operation.offset, operation.offset + operation.limit);
		}
		if (operation.kind === "byIds") {
			return Array.from(new Set(operation.ids)).sort();
		}
		if (operation.kind === "byId") {
			return group.find((row) => row.id === operation.id)?.email;
		}
		return undefined;
	};

	const results = await cluster.run(operations.map((operation) => () => perform(operation)));

	const violations: string[] = [];
	operations.forEach((operation, task) => {
		const result = results[task];
		const label = `task ${task} (${JSON.stringify(operation)})`;
		if (result.status === "rejected") {
			if (!environment.isExpectedFailure(result.reason)) {
				violations.push(`${label} failed unexpectedly: ${describeFailure(result.reason)}`);
			}
			return;
		}
		if (operation.kind === "noise") {
			return;
		}
		if (JSON.stringify(result.value) !== JSON.stringify(expected(operation))) {
			violations.push(
				`${label} answered ${JSON.stringify(result.value)}, expected ${JSON.stringify(expected(operation))}`,
			);
		}
	});
	return violations;
};

describe("chaos: reads of unchanged rows are exact", () => {
	for (const profile of CHAOS_PROFILES) {
		test(profile.name, async () => {
			const totals = await runChaos({ profile, scenario: stableReadsScenario });
			const missing = expectChaosHappened(profile, totals);
			if (profile.faults.shortPageRate > 0 && totals.shortPages === 0 && totals.runs >= 10) {
				missing.push(`profile "${profile.name}" never produced short pages`);
			}
			if (profile.faults.unprocessedKeysRate > 0 && totals.partialBatches === 0 && totals.runs >= 10) {
				missing.push(`profile "${profile.name}" never produced partial batches`);
			}
			expect(missing).toEqual([]);
		});
	}
});
