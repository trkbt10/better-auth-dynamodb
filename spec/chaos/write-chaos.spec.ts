/**
 * @file Chaos specs for single-row writes (create / update / delete).
 *
 * Creators, updaters and deleters race for the same row while the cluster
 * reorders their requests, serves stale index reads and fails requests.
 * Every write the cluster applied is checked: a create never replaces a row,
 * an update never brings a deleted row back or touches what it did not
 * assign, and a list or JSON value is always the one a single caller wrote.
 */
import {
	CHAOS_PROFILES,
	describeFailure,
	expectChaosHappened,
	runChaos,
	type ChaosEnvironment,
} from "./chaos-harness";

type UserRow = {
	id: string;
	email: string;
	name: string;
	tags?: string[] | null;
	prefs?: Record<string, unknown> | null;
};

const REQUIRED_USER_ATTRIBUTES = ["id", "name", "email", "emailVerified", "createdAt", "updatedAt"];

const hasSameContent = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left) === JSON.stringify(right);

type ContestedOperation =
	| { kind: "create"; name: string }
	| { kind: "rename"; name: string }
	| { kind: "remove" };

const contestedRowScenario = async (environment: ChaosEnvironment): Promise<string[]> => {
	const { cluster } = environment;
	const { random } = cluster;
	const adapter = environment.createAdapter();
	const table = environment.tableName("user");
	const id = "contested";

	const create = (name: string): Promise<UserRow> =>
		adapter.create<Record<string, unknown>, UserRow>({
			model: "user",
			data: { id, name, email: `${name}@example.com` },
			forceAllowId: true,
		});

	if (random.chance(0.5)) {
		await create("initial");
	}
	cluster.settle();

	const operations: ContestedOperation[] = Array.from({ length: 6 + random.int(7) }, (_, index) => {
		const kind = random.pick(["create", "create", "rename", "rename", "remove"] as const);
		if (kind === "create") {
			return { kind, name: `creator-${index}` };
		}
		if (kind === "rename") {
			return { kind, name: `renamed-${index}` };
		}
		return { kind };
	});

	const perform = (operation: ContestedOperation): Promise<UserRow | null | void> => {
		if (operation.kind === "create") {
			return create(operation.name);
		}
		if (operation.kind === "rename") {
			return adapter.update<UserRow>({
				model: "user",
				where: [{ field: "id", value: id }],
				update: { name: operation.name },
			});
		}
		return adapter.delete({ model: "user", where: [{ field: "id", value: id }] });
	};

	const violations: string[] = [];
	// No write may leave a row without the attributes every user has: that is
	// what an update of a row that was deleted in the meantime would do.
	cluster.afterWrite((write) => {
		if (write.tableName !== table || !write.next) {
			return;
		}
		const missing = REQUIRED_USER_ATTRIBUTES.filter((attribute) => write.next?.[attribute] === undefined);
		if (missing.length > 0) {
			violations.push(`task ${write.task} stored a row without ${missing.join(", ")}`);
		}
	});

	const results = await cluster.run(operations.map((operation) => () => perform(operation)));

	operations.forEach((operation, task) => {
		const label = `task ${task} (${operation.kind})`;
		const result = results[task];
		const lostResponses = cluster.faultsOf(task).lostResponses;
		const allowedCodes = operation.kind === "create" ? ["DUPLICATE_PRIMARY_KEY"] : [];
		if (result.status === "rejected" && !environment.isExpectedFailure(result.reason, allowedCodes)) {
			violations.push(`${label} failed unexpectedly: ${describeFailure(result.reason)}`);
		}
		const writes = cluster.writes.filter((write) => write.task === task && write.tableName === table);
		if (writes.length > 1 + lostResponses) {
			violations.push(`${label} wrote ${writes.length} times`);
		}
		writes.forEach((write) => {
			if (operation.kind === "create") {
				if (write.previous !== undefined) {
					violations.push(`${label} replaced an existing row`);
				}
				if (write.next?.name !== operation.name || write.next?.email !== `${operation.name}@example.com`) {
					violations.push(`${label} stored a row that is not the one it created`);
				}
				return;
			}
			if (operation.kind === "rename") {
				if (write.previous === undefined) {
					violations.push(`${label} created a row by updating it`);
					return;
				}
				if (write.next?.name !== operation.name) {
					violations.push(`${label} stored ${String(write.next?.name)}`);
				}
				if (write.next?.email !== write.previous.email || write.next?.createdAt !== write.previous.createdAt) {
					violations.push(`${label} changed attributes it did not assign`);
				}
				return;
			}
			if (write.next !== undefined) {
				violations.push(`${label} wrote a row instead of deleting it`);
			}
		});
		if (result.status !== "fulfilled") {
			return;
		}
		if (operation.kind === "create" && writes.length === 0) {
			violations.push(`${label} reported a row it did not create`);
		}
		if (operation.kind === "rename") {
			const row = result.value as UserRow | null;
			if (row && writes.length === 0) {
				violations.push(`${label} reported an update it did not make`);
			}
			if (row && row.name !== operation.name) {
				violations.push(`${label} returned ${row.name}`);
			}
			if (!row && writes.length > lostResponses) {
				violations.push(`${label} updated the row but reported none`);
			}
		}
	});
	return violations;
};

type WholeValueOperation = {
	by: "id" | "email";
	tags?: string[] | undefined;
	prefs?: Record<string, unknown> | undefined;
};

const wholeValueScenario = async (environment: ChaosEnvironment): Promise<string[]> => {
	const { cluster } = environment;
	const { random } = cluster;
	const adapter = environment.createAdapter();
	const table = environment.tableName("user");
	const email = "whole@example.com";

	const user = await adapter.create<Record<string, unknown>, UserRow>({
		model: "user",
		data: {
			name: "whole",
			email,
			tags: ["initial-a", "initial-b"],
			prefs: { owner: "initial", nested: { value: 0, list: [0] } },
		},
	});
	cluster.settle();

	const operations: WholeValueOperation[] = Array.from({ length: 5 + random.int(6) }, (_, index) => {
		const fields = random.pick(["both", "tags", "prefs"] as const);
		const tags = [`t${index}-a`, `t${index}-b`, `t${index}-c`].slice(0, 1 + random.int(3));
		const prefs = { owner: `task-${index}`, nested: { value: index, list: [index, index + 1] } };
		return {
			by: random.pick(["id", "email"] as const),
			tags: fields === "prefs" ? undefined : tags,
			prefs: fields === "tags" ? undefined : prefs,
		};
	});

	const assignmentsOf = (operation: WholeValueOperation): Record<string, unknown> =>
		Object.fromEntries(
			Object.entries({ tags: operation.tags, prefs: operation.prefs }).filter(
				([, value]) => value !== undefined,
			),
		);

	const perform = (operation: WholeValueOperation): Promise<UserRow | null> =>
		adapter.update<UserRow>({
			model: "user",
			where: [
				operation.by === "id" ? { field: "id", value: user.id } : { field: "email", value: email },
			],
			update: assignmentsOf(operation),
		});

	const results = await cluster.run(operations.map((operation) => () => perform(operation)));

	const violations: string[] = [];
	operations.forEach((operation, task) => {
		const label = `task ${task} (update by ${operation.by})`;
		const result = results[task];
		const assignments = assignmentsOf(operation);
		if (result.status === "rejected" && !environment.isExpectedFailure(result.reason)) {
			violations.push(`${label} failed unexpectedly: ${describeFailure(result.reason)}`);
		}
		const writes = cluster.writes.filter((write) => write.task === task && write.tableName === table);
		writes.forEach((write) => {
			for (const field of ["tags", "prefs"]) {
				const assigned = field in assignments;
				const expected = assigned ? assignments[field] : write.previous?.[field];
				if (!hasSameContent(write.next?.[field], expected)) {
					violations.push(
						`${label} stored ${field}=${JSON.stringify(write.next?.[field])}, expected ${JSON.stringify(expected)}`,
					);
				}
			}
			if (write.next?.name !== "whole" || write.next?.email !== email) {
				violations.push(`${label} changed attributes it did not assign`);
			}
		});
		// The row is never deleted and its email never changes, so an update
		// that was not disturbed has to find it, even through a stale index.
		const faults = cluster.faultsOf(task);
		const undisturbed = faults.rejected + faults.lostResponses === 0;
		if (result.status === "fulfilled" && result.value === null && undisturbed) {
			violations.push(`${label} found no row although its where clause always matches`);
		}
	});
	return violations;
};

describe("chaos: a contested row is never replaced, resurrected or left partial", () => {
	for (const profile of CHAOS_PROFILES) {
		test(profile.name, async () => {
			const totals = await runChaos({ profile, scenario: contestedRowScenario });
			expect(expectChaosHappened(profile, totals)).toEqual([]);
		});
	}
});

describe("chaos: list and JSON values are written whole", () => {
	for (const profile of CHAOS_PROFILES) {
		test(profile.name, async () => {
			const totals = await runChaos({ profile, scenario: wholeValueScenario });
			expect(expectChaosHappened(profile, totals)).toEqual([]);
		});
	}
});
