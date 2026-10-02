/**
 * @file Chaos specs for Better Auth flows that rest on the atomic methods.
 *
 * The flows are driven through the public Better Auth API, so the queries,
 * guards and retries are the ones Better Auth itself issues, while the
 * cluster reorders requests, serves stale index reads and fails requests.
 * The invariants are the ones a user of the flow relies on: a reset token
 * changes the password at most once, and a rate limit admits at most `max`.
 */
import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { DynamoDBAdapterError } from "../../src/dynamodb/errors/errors";
import {
	CHAOS_PROFILES,
	describeFailure,
	expectChaosHappened,
	resolveSeeds,
	runChaos,
	type ChaosEnvironment,
	type ChaosProfile,
} from "./chaos-harness";

const BASE_OPTIONS = {
	secret: "test-secret-at-least-32-characters-long!!",
	baseURL: "http://localhost:3000",
	trustedOrigins: ["http://localhost:3000"],
	emailAndPassword: { enabled: true },
} satisfies BetterAuthOptions;

/**
 * A flow run hashes passwords, so fewer seeds are tried per profile than for
 * the adapter-level scenarios: `CHAOS_FLOW_RUNS` (default 6), or the one seed
 * of `CHAOS_SEED`.
 */
const resolveFlowSeeds = (): number[] => {
	if (process.env.CHAOS_SEED !== undefined && process.env.CHAOS_SEED !== "") {
		return resolveSeeds();
	}
	const runs = Number(process.env.CHAOS_FLOW_RUNS ?? "6");
	return Array.from({ length: runs }, (_, index) => index + 1);
};

// Whether the profile can make an operation fail: a rejected request, a lost
// response, or a batch that stays partial until the adapter gives up on it.
const injectsFailures = (profile: ChaosProfile): boolean => {
	const { rejectRate, lostResponseRate, unprocessedKeysRate } = profile.faults;
	return rejectRate + lostResponseRate + unprocessedKeysRate > 0;
};

// A flow may fail for its own reasons (an invalid token, a failure the
// cluster injected). An error of the adapter that the profile does not
// explain, or of a request the adapter built, is a defect.
const isAdapterDefect = (environment: ChaosEnvironment, reason: unknown): boolean => {
	if (reason instanceof DynamoDBAdapterError) {
		return !environment.isExpectedFailure(reason);
	}
	if (!(reason instanceof Error)) {
		return false;
	}
	return ["ValidationException", "FakeDynamoDBUnsupportedError", "TypeError"].includes(reason.name);
};

const passwordResetScenario =
	(profile: ChaosProfile, transaction: boolean) =>
	async (environment: ChaosEnvironment): Promise<string[]> => {
		const { cluster } = environment;
		const tokens: string[] = [];
		const auth = betterAuth({
			...BASE_OPTIONS,
			emailAndPassword: {
				enabled: true,
				sendResetPassword: async ({ token }) => {
					tokens.push(token);
				},
			},
			database: environment.createDatabase(transaction),
		});
		const email = "reset@example.com";
		await auth.api.signUpEmail({ body: { email, password: "the-first-password", name: "Reset" } });
		await auth.api.requestPasswordReset({
			body: { email, redirectTo: "http://localhost:3000/reset" },
		});
		const [token] = tokens;
		cluster.settle();

		const attempts = Array.from({ length: 3 + cluster.random.int(3) }, (_, index) => `new-password-${index}`);
		const results = await cluster.run(
			attempts.map(
				(newPassword) => () => auth.api.resetPassword({ body: { newPassword, token } }),
			),
		);

		const violations: string[] = [];
		const accountTable = environment.tableName("account");
		const verificationTable = environment.tableName("verification");
		results.forEach((result, task) => {
			if (result.status === "rejected" && isAdapterDefect(environment, result.reason)) {
				violations.push(`task ${task} hit an adapter defect: ${describeFailure(result.reason)}`);
			}
		});
		// Writes of the attempts only: the sign-up before the run wrote too.
		const attemptWrites = cluster.writes.filter((write) => write.task !== undefined);
		const consumers = new Set(
			attemptWrites
				.filter((write) => write.tableName === verificationTable && write.next === undefined)
				.map((write) => write.task),
		);
		const passwordWriters = new Set(
			attemptWrites.filter((write) => write.tableName === accountTable).map((write) => write.task),
		);
		passwordWriters.forEach((task) => {
			if (!consumers.has(task)) {
				violations.push(`task ${task} changed the password without consuming the token`);
			}
		});
		if (passwordWriters.size > 1) {
			violations.push(`the password was changed by ${passwordWriters.size} attempts`);
		}
		const succeeded = results.filter((result) => result.status === "fulfilled").length;
		if (succeeded > 1) {
			violations.push(`${succeeded} resets succeeded with one token`);
		}
		if (!injectsFailures(profile) && succeeded !== 1) {
			violations.push(`${succeeded} resets succeeded although nothing failed`);
		}
		return violations;
	};

const RATE_LIMIT_MAX = 4;

const RATE_LIMIT_OPTIONS = {
	...BASE_OPTIONS,
	rateLimit: { enabled: true, storage: "database", window: 600, max: RATE_LIMIT_MAX },
	advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
} satisfies BetterAuthOptions;

const rateLimitScenario =
	(profile: ChaosProfile) =>
	async (environment: ChaosEnvironment): Promise<string[]> => {
		const { cluster } = environment;
		const auth = betterAuth({ ...RATE_LIMIT_OPTIONS, database: environment.createDatabase() });
		const table = environment.tableName("rateLimit");
		const request = async (): Promise<number> => {
			const response = await auth.handler(
				new Request("http://localhost:3000/api/auth/ok", {
					headers: { "x-forwarded-for": "203.0.113.50" },
				}),
			);
			return response.status;
		};

		// The first request creates the counter. Better Auth leaves it to a
		// unique constraint to keep concurrent first requests from creating
		// several; DynamoDB has none on a non-key attribute, so the burst
		// starts from an existing counter.
		const first = await request();
		cluster.settle();

		const burst = RATE_LIMIT_MAX + 2 + cluster.random.int(5);
		const results = await cluster.run(Array.from({ length: burst }, () => () => request()));

		const violations: string[] = [];
		if (first !== 200) {
			violations.push(`the first request was answered with ${first}`);
		}
		cluster.writes
			.filter((write) => write.tableName === table)
			.forEach((write) => {
				const count = Number(write.next?.count ?? 0);
				if (count > RATE_LIMIT_MAX) {
					violations.push(`task ${write.task} raised the counter to ${count}`);
				}
			});
		results.forEach((result, task) => {
			if (result.status === "rejected" && isAdapterDefect(environment, result.reason)) {
				violations.push(`task ${task} hit an adapter defect: ${describeFailure(result.reason)}`);
			}
		});
		const statuses = results.map((result) => (result.status === "fulfilled" ? result.value : 0));
		const admitted = statuses.filter((status) => status === 200).length;
		if (admitted > RATE_LIMIT_MAX - 1) {
			violations.push(`${admitted + 1} requests were admitted, the limit is ${RATE_LIMIT_MAX}`);
		}
		if (!injectsFailures(profile) && admitted !== RATE_LIMIT_MAX - 1) {
			violations.push(`${admitted + 1} requests were admitted although nothing failed: ${statuses.join()}`);
		}
		return violations;
	};

// With adapter transactions Better Auth consumes the token and clears its
// identifier in one transaction, which a conflict can cancel as a whole.
for (const transaction of [false, true]) {
	describe(`chaos: a password reset token changes the password at most once (transaction: ${transaction})`, () => {
		for (const profile of CHAOS_PROFILES) {
			test(profile.name, async () => {
				await runChaos({
					profile,
					scenario: passwordResetScenario(profile, transaction),
					options: BASE_OPTIONS,
					seeds: resolveFlowSeeds(),
				});
			}, 120000);
		}
	});
}

describe("chaos: a database rate limit admits at most its maximum", () => {
	for (const profile of CHAOS_PROFILES) {
		test(profile.name, async () => {
			const totals = await runChaos({
				profile,
				scenario: rateLimitScenario(profile),
				options: RATE_LIMIT_OPTIONS,
				seeds: resolveFlowSeeds(),
			});
			expect(expectChaosHappened(profile, { ...totals, runs: 10 * totals.runs })).toEqual([]);
		}, 120000);
	}
});
