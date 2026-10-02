/**
 * @file Chaos specs for adapter transactions (`transaction: true`).
 *
 * Concurrent transactions move units between counters and claim single-use
 * rows while the cluster reorders requests, serves stale reads, cancels
 * transactions and loses their responses. Between any two requests the
 * stored rows have to be consistent: a transaction is applied in full or not
 * at all, and never on top of rows that changed after it read them.
 */
import {
	CHAOS_PROFILES,
	describeFailure,
	expectChaosHappened,
	runChaos,
	type ChaosEnvironment,
} from "./chaos-harness";

type UserRow = { id: string; name: string; email: string; loginCount?: number | null };

type VerificationRow = { id: string; identifier: string; value: string };

const balanceOf = (row: Record<string, unknown> | undefined): number => {
	const value = row?.loginCount;
	return typeof value === "number" ? value : 0;
};

// An account is addressed by its id (a strongly consistent read) or by its
// email (an index read, which may be stale).
type Transfer = { from: string; to: string; amount: number; by: "id" | "email" };

const transferScenario = async (environment: ChaosEnvironment): Promise<string[]> => {
	const { cluster } = environment;
	const { random } = cluster;
	const adapter = environment.createAdapter(true);
	const table = environment.tableName("user");
	const accounts = ["account-a", "account-b", "account-c"];
	const openingBalance = 4;

	for (const id of accounts) {
		await adapter.create({
			model: "user",
			data: { id, name: id, email: `${id}@example.com`, loginCount: openingBalance },
			forceAllowId: true,
		});
	}
	cluster.settle();

	const transfers: Transfer[] = Array.from({ length: 6 + random.int(8) }, () => {
		const from = random.pick(accounts);
		const to = random.pick(accounts.filter((account) => account !== from));
		return { from, to, amount: 1 + random.int(3), by: random.pick(["id", "email"] as const) };
	});
	const selectAccount = (transfer: Transfer, account: string) => {
		if (transfer.by === "email") {
			return { field: "email", value: `${account}@example.com` };
		}
		return { field: "id", value: account };
	};

	const perform = (transfer: Transfer): Promise<"moved" | "insufficient"> =>
		adapter.transaction(async (tx) => {
			const debited = await tx.incrementOne<UserRow>({
				model: "user",
				where: [
					selectAccount(transfer, transfer.from),
					{ field: "loginCount", operator: "gte", value: transfer.amount },
				],
				increment: { loginCount: -transfer.amount },
			});
			if (!debited) {
				return "insufficient";
			}
			const credited = await tx.incrementOne<UserRow>({
				model: "user",
				where: [selectAccount(transfer, transfer.to)],
				increment: { loginCount: transfer.amount },
			});
			if (!credited) {
				throw new Error(`Account ${transfer.to} disappeared.`);
			}
			return "moved";
		});

	const violations: string[] = [];
	// Between two requests the books balance: a commit is one request.
	cluster.afterRequest(() => {
		const rows = cluster.store.get(table);
		const total = rows.reduce((sum, row) => sum + balanceOf(row), 0);
		if (total !== openingBalance * accounts.length) {
			violations.push(`the balances add up to ${total}`);
		}
		rows.forEach((row) => {
			if (balanceOf(row) < 0) {
				violations.push(`${String(row.id)} is overdrawn: ${balanceOf(row)}`);
			}
		});
	});

	const results = await cluster.run(transfers.map((transfer) => () => perform(transfer)));

	transfers.forEach((transfer, task) => {
		const label = `task ${task} (${transfer.amount} from ${transfer.from} to ${transfer.to})`;
		const result = results[task];
		const lostResponses = cluster.faultsOf(task).lostResponses;
		if (result.status === "rejected" && !environment.isExpectedFailure(result.reason)) {
			violations.push(`${label} failed unexpectedly: ${describeFailure(result.reason)}`);
		}
		const writes = cluster.writes.filter((write) => write.task === task && write.tableName === table);
		if (writes.length !== 0 && writes.length !== 2) {
			violations.push(`${label} applied ${writes.length} writes`);
		}
		writes.forEach((write) => {
			const delta = balanceOf(write.next) - balanceOf(write.previous);
			const expected = write.next?.id === transfer.from ? -transfer.amount : transfer.amount;
			if (delta !== expected) {
				violations.push(`${label} moved ${String(write.next?.id)} by ${delta}`);
			}
		});
		const moved = result.status === "fulfilled" ? result.value === "moved" : false;
		if (moved && writes.length !== 2) {
			violations.push(`${label} reported a transfer that was not applied`);
		}
		if (!moved && writes.length > 0 && lostResponses === 0) {
			violations.push(`${label} applied a transfer it did not report`);
		}
	});
	return violations;
};

const claimScenario = async (environment: ChaosEnvironment): Promise<string[]> => {
	const { cluster } = environment;
	const { random } = cluster;
	const adapter = environment.createAdapter(true);
	const userTable = environment.tableName("user");
	const verificationTable = environment.tableName("verification");
	const identifiers = ["token-a", "token-b"];

	const tokens: VerificationRow[] = [];
	for (const identifier of identifiers) {
		const count = 1 + random.int(2);
		for (let index = 0; index < count; index += 1) {
			tokens.push(
				await adapter.create<Record<string, unknown>, VerificationRow>({
					model: "verification",
					data: { identifier, value: "v", expiresAt: new Date("2100-01-01T00:00:00.000Z") },
				}),
			);
		}
	}
	cluster.settle();

	const claims = Array.from({ length: 5 + random.int(6) }, () => ({
		identifier: random.pick(identifiers),
		byId: random.chance(0.4) ? random.pick(tokens).id : undefined,
	}));

	const selectToken = (claim: (typeof claims)[number]) => {
		if (claim.byId === undefined) {
			return { field: "identifier", value: claim.identifier };
		}
		return { field: "id", value: claim.byId };
	};

	// Consume a token and record the claim in the same transaction.
	const perform = (claim: (typeof claims)[number]): Promise<string | null> =>
		adapter.transaction(async (tx) => {
			const token = await tx.consumeOne<VerificationRow>({
				model: "verification",
				where: [selectToken(claim)],
			});
			if (!token) {
				return null;
			}
			await tx.create({
				model: "user",
				data: {
					id: `claim-${token.id}`,
					name: "claim",
					email: `claim-${token.id}@example.com`,
				},
				forceAllowId: true,
			});
			return token.id;
		});

	const violations: string[] = [];
	// A token is gone exactly when its claim exists.
	cluster.afterRequest(() => {
		const stored = cluster.store.get(verificationTable).map((row) => String(row.id));
		const claimed = cluster.store
			.get(userTable)
			.map((row) => String(row.id))
			.filter((id) => id.startsWith("claim-"))
			.map((id) => id.slice("claim-".length));
		tokens.forEach((token) => {
			const consumed = !stored.includes(token.id);
			if (consumed !== claimed.includes(token.id)) {
				violations.push(`token ${token.id}: consumed=${consumed} but claimed=${claimed.includes(token.id)}`);
			}
		});
	});

	const results = await cluster.run(claims.map((claim) => () => perform(claim)));

	const acknowledged: string[] = [];
	claims.forEach((claim, task) => {
		const label = `task ${task} (claim ${claim.byId ?? claim.identifier})`;
		const result = results[task];
		if (result.status === "rejected") {
			if (!environment.isExpectedFailure(result.reason)) {
				violations.push(`${label} failed unexpectedly: ${describeFailure(result.reason)}`);
			}
			return;
		}
		if (result.value === null) {
			return;
		}
		acknowledged.push(result.value);
		const deleted = cluster.writes.some(
			(write) =>
				write.task === task && write.tableName === verificationTable && write.previous?.id === result.value,
		);
		if (!deleted) {
			violations.push(`${label} reported token ${result.value} without consuming it`);
		}
	});
	if (new Set(acknowledged).size !== acknowledged.length) {
		violations.push(`a token was claimed twice: ${acknowledged.join(", ")}`);
	}
	return violations;
};

const slotScenario = async (environment: ChaosEnvironment): Promise<string[]> => {
	const { cluster } = environment;
	const { random } = cluster;
	const adapter = environment.createAdapter(true);
	const table = environment.tableName("user");
	const slots = ["slot-a", "slot-b"];

	const contenders = Array.from({ length: 5 + random.int(6) }, (_, index) => ({
		slot: random.pick(slots),
		name: `contender-${index}`,
	}));

	// Take a slot (a row with a fixed id) and write a row of one's own with it.
	const perform = (contender: (typeof contenders)[number]): Promise<string> =>
		adapter.transaction(async (tx) => {
			await tx.create({
				model: "user",
				data: { id: contender.slot, name: contender.name, email: `${contender.name}@slot.example.com` },
				forceAllowId: true,
			});
			await tx.create({
				model: "user",
				data: { id: `receipt-${contender.name}`, name: contender.name, email: `${contender.name}@receipt.example.com` },
				forceAllowId: true,
			});
			return contender.name;
		});

	const violations: string[] = [];
	// A receipt exists exactly for the contender who holds a slot.
	cluster.afterRequest(() => {
		const rows = cluster.store.get(table);
		const holders = rows.filter((row) => slots.includes(String(row.id))).map((row) => String(row.name));
		const receipts = rows
			.filter((row) => String(row.id).startsWith("receipt-"))
			.map((row) => String(row.name));
		if ([...holders].sort().join() !== [...receipts].sort().join()) {
			violations.push(`slots are held by [${holders.join()}], receipts exist for [${receipts.join()}]`);
		}
	});

	const results = await cluster.run(contenders.map((contender) => () => perform(contender)));

	contenders.forEach((contender, task) => {
		const label = `task ${task} (${contender.name} for ${contender.slot})`;
		const result = results[task];
		if (result.status === "rejected" && !environment.isExpectedFailure(result.reason)) {
			violations.push(`${label} failed unexpectedly: ${describeFailure(result.reason)}`);
		}
		const writes = cluster.writes.filter((write) => write.task === task && write.tableName === table);
		writes.forEach((write) => {
			if (write.previous !== undefined) {
				violations.push(`${label} replaced the existing row ${String(write.previous.id)}`);
			}
		});
		if (result.status === "fulfilled" && writes.length !== 2) {
			violations.push(`${label} reported a slot it did not take`);
		}
	});
	slots.forEach((slot) => {
		const winners = contenders.filter(
			(contender, task) => contender.slot === slot && results[task].status === "fulfilled",
		);
		if (winners.length > 1) {
			violations.push(`${slot} was taken by ${winners.length} contenders`);
		}
	});
	return violations;
};

const ownWritesScenario = async (environment: ChaosEnvironment): Promise<string[]> => {
	const { cluster } = environment;
	const { random } = cluster;
	const adapter = environment.createAdapter(true);
	const group = "own-writes";

	const stored = await adapter.create<Record<string, unknown>, UserRow>({
		model: "user",
		data: { name: group, email: "stored@own.example.com", loginCount: 1 },
	});
	cluster.settle();

	const sessions = Array.from({ length: 3 + random.int(4) }, (_, index) => `session-${index}`);
	const violations: string[] = [];

	// Each transaction creates, updates and deletes rows of its own and checks
	// after every step that its reads show exactly what it wrote so far.
	const perform = (name: string): Promise<void> =>
		adapter.transaction(async (tx) => {
			const email = `${name}@own.example.com`;
			const matchesRow = (row: UserRow | null, expected: Partial<UserRow> | null): boolean => {
				if (expected === null) {
					return row === null;
				}
				return Object.entries(expected).every(([key, value]) => row?.[key as keyof UserRow] === value);
			};
			const expectRow = (step: string, row: UserRow | null, expected: Partial<UserRow> | null) => {
				if (!matchesRow(row, expected)) {
					violations.push(`${name}: after ${step}, read ${JSON.stringify(row)}`);
				}
			};
			const created = await tx.create<Record<string, unknown>, UserRow>({
				model: "user",
				data: { name, email, loginCount: 0 },
			});
			const byId = [{ field: "id", value: created.id }];
			const byEmail = [{ field: "email", value: email }];
			expectRow("create (by id)", await tx.findOne<UserRow>({ model: "user", where: byId }), { name });
			expectRow("create (by email)", await tx.findOne<UserRow>({ model: "user", where: byEmail }), { name });
			const listed = await tx.findMany<UserRow>({ model: "user", where: byEmail });
			if (listed.length !== 1) {
				violations.push(`${name}: after create, findMany returned ${listed.length} rows`);
			}
			if ((await tx.count({ model: "user", where: byEmail })) !== 1) {
				violations.push(`${name}: after create, count was not 1`);
			}

			await tx.update({ model: "user", where: byEmail, update: { name: `${name}-renamed` } });
			expectRow("update", await tx.findOne<UserRow>({ model: "user", where: byId }), {
				name: `${name}-renamed`,
			});
			const incremented = await tx.incrementOne<UserRow>({
				model: "user",
				where: byId,
				increment: { loginCount: 2 },
			});
			expectRow("incrementOne (returned)", incremented, { loginCount: 2 });
			expectRow("incrementOne", await tx.findOne<UserRow>({ model: "user", where: byEmail }), {
				loginCount: 2,
				name: `${name}-renamed`,
			});

			// A stored row, read through its index and changed by the transaction.
			const storedWhere = [{ field: "email", value: stored.email }];
			const seen = await tx.findOne<UserRow>({ model: "user", where: storedWhere });
			if (seen) {
				await tx.update({ model: "user", where: [{ field: "id", value: stored.id }], update: { name: `${group}-${name}` } });
				expectRow("update of a stored row", await tx.findOne<UserRow>({ model: "user", where: storedWhere }), {
					name: `${group}-${name}`,
				});
			}

			await tx.delete({ model: "user", where: byId });
			expectRow("delete (by id)", await tx.findOne<UserRow>({ model: "user", where: byId }), null);
			expectRow("delete (by email)", await tx.findOne<UserRow>({ model: "user", where: byEmail }), null);
			if ((await tx.count({ model: "user", where: byEmail })) !== 0) {
				violations.push(`${name}: after delete, count was not 0`);
			}
		});

	const results = await cluster.run(sessions.map((name) => () => perform(name)));

	sessions.forEach((name, task) => {
		const result = results[task];
		if (result.status === "rejected" && !environment.isExpectedFailure(result.reason)) {
			violations.push(`${name} failed unexpectedly: ${describeFailure(result.reason)}`);
		}
	});
	return violations;
};

describe("chaos: transactions move units without creating or losing any", () => {
	for (const profile of CHAOS_PROFILES) {
		test(profile.name, async () => {
			const totals = await runChaos({ profile, scenario: transferScenario });
			expect(expectChaosHappened(profile, totals)).toEqual([]);
		});
	}
});

describe("chaos: a transaction consumes a row and records it together", () => {
	for (const profile of CHAOS_PROFILES) {
		test(profile.name, async () => {
			const totals = await runChaos({ profile, scenario: claimScenario });
			expect(expectChaosHappened(profile, totals)).toEqual([]);
		});
	}
});

describe("chaos: a transaction takes a fixed id at most once", () => {
	for (const profile of CHAOS_PROFILES) {
		test(profile.name, async () => {
			await runChaos({ profile, scenario: slotScenario });
		});
	}
});

describe("chaos: a transaction reads its own writes", () => {
	for (const profile of CHAOS_PROFILES) {
		test(profile.name, async () => {
			const totals = await runChaos({ profile, scenario: ownWritesScenario });
			expect(expectChaosHappened(profile, totals)).toEqual([]);
		});
	}
});
