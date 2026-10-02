/**
 * @file Shared scaffolding of the chaos specs: fault profiles, seeds, the
 * adapter under test and the classification of what an operation may answer.
 */
import type { BetterAuthOptions } from "@better-auth/core";
import type { DBAdapter } from "@better-auth/core/db/adapter";
import { dynamodbAdapter } from "../../src/adapter";
import { DynamoDBAdapterError } from "../../src/dynamodb/errors/errors";
import {
	createIndexResolversFromSchemas,
	generateTableSchemas,
} from "../../src/table-schemas";
import {
	createChaosCluster,
	NO_FAULTS,
	type ChaosCluster,
	type ChaosFaults,
} from "./chaos-cluster";
import { resolveChaosSeeds } from "./chaos-seeds";

export type ChaosProfile = { name: string; faults: ChaosFaults };

const LAG: ChaosFaults = {
	...NO_FAULTS,
	staleReadRate: 0.6,
	maxLag: 4,
	fracturedReads: true,
};

/**
 * Each profile adds one kind of failure to replication lag and random
 * interleaving, which are always on (except in the first, the baseline for
 * interleaving alone).
 */
export const CHAOS_PROFILES: ChaosProfile[] = [
	{ name: "interleaving only", faults: NO_FAULTS },
	{ name: "replication lag", faults: LAG },
	{ name: "replication lag, whole-table snapshots", faults: { ...LAG, fracturedReads: false } },
	{
		name: "replication lag + rejected requests",
		faults: { ...LAG, rejectRate: 0.12, transactionConflictRate: 0.15 },
	},
	{ name: "replication lag + lost responses", faults: { ...LAG, lostResponseRate: 0.15 } },
	{
		name: "replication lag + lost responses re-sent",
		faults: { ...LAG, lostResponseRate: 0.15, resendLostRequests: true },
	},
	{ name: "heavy replication lag", faults: { ...LAG, staleReadRate: 0.95, maxLag: 12 } },
	{
		name: "replication lag + short pages and partial batches",
		faults: { ...LAG, shortPageRate: 0.6, unprocessedKeysRate: 0.3 },
	},
	{
		name: "everything at once",
		faults: {
			...LAG,
			maxLag: 8,
			rejectRate: 0.06,
			transactionConflictRate: 0.1,
			lostResponseRate: 0.1,
			resendLostRequests: true,
			shortPageRate: 0.4,
			unprocessedKeysRate: 0.2,
		},
	},
	{
		name: "every eventual read lags behind",
		faults: { ...LAG, staleReadRate: 1, maxLag: 32, fracturedReads: false },
	},
	{
		name: "every lost write response is re-sent",
		faults: { ...LAG, lostResponseRate: 1, resendLostRequests: true },
	},
	{
		name: "persistent partial batches and tiny pages",
		faults: { ...LAG, shortPageRate: 1, unprocessedKeysRate: 1 },
	},
	{
		name: "severe throttling with transaction conflicts",
		faults: {
			...LAG,
			maxLag: 32,
			rejectRate: 0.6,
			transactionConflictRate: 0.6,
			shortPageRate: 0.8,
			unprocessedKeysRate: 0.8,
		},
	},
];

/**
 * The seeds of a run: `CHAOS_SEED` replays one, `CHAOS_RUNS` sets how many are
 * tried per profile (default 40).
 */
export const resolveSeeds = (): number[] => {
	return resolveChaosSeeds({
		seed: process.env.CHAOS_SEED,
		runs: process.env.CHAOS_RUNS,
		defaultRuns: 40,
	});
};

export const CHAOS_OPTIONS: BetterAuthOptions = {
	user: {
		additionalFields: {
			loginCount: { type: "number", required: false },
			tags: { type: "string[]", required: false },
			prefs: { type: "json", required: false },
		},
	},
};

export type ChaosEnvironment = {
	seed: number;
	profile: ChaosProfile;
	cluster: ChaosCluster;
	tableName: (model: string) => string;
	/** The adapter, bound to the options of the environment. */
	createAdapter: (transaction?: boolean) => DBAdapter<BetterAuthOptions>;
	/** The adapter factory, to hand to `betterAuth({ database })`. */
	createDatabase: (transaction?: boolean) => ReturnType<typeof dynamodbAdapter>;
	/**
	 * Whether an operation failed in a way the profile explains. `allowedCodes`
	 * names adapter errors that are a legitimate answer in the scenario.
	 */
	isExpectedFailure: (reason: unknown, allowedCodes?: string[]) => boolean;
};

const TABLE_NAME_PREFIX = "chaos_";

// Pages can be cut to a single evaluated item, so a scan takes many of them.
const SCAN_MAX_PAGES = 100000;

// When batches come back partial over and over, the adapter gives up on the
// batch with this error after its retries.
const profileFailureCodes = (profile: ChaosProfile): string[] => {
	if (profile.faults.unprocessedKeysRate > 0) {
		return ["BATCH_GET_UNPROCESSED"];
	}
	return [];
};

export const createChaosEnvironment = (props: {
	seed: number;
	profile: ChaosProfile;
	options?: BetterAuthOptions | undefined;
}): ChaosEnvironment => {
	const options = props.options ?? CHAOS_OPTIONS;
	const schemas = generateTableSchemas(options);
	const cluster = createChaosCluster({
		seed: props.seed,
		faults: props.profile.faults,
		tableSchemas: schemas,
		tableNamePrefix: TABLE_NAME_PREFIX,
	});
	const resolvers = createIndexResolversFromSchemas(schemas);
	return {
		seed: props.seed,
		profile: props.profile,
		cluster,
		tableName: (model) => `${TABLE_NAME_PREFIX}${model}`,
		createDatabase: (transaction = false) =>
			dynamodbAdapter({
				documentClient: cluster.documentClient,
				tableNamePrefix: TABLE_NAME_PREFIX,
				scanMaxPages: SCAN_MAX_PAGES,
				transaction,
				...resolvers,
			}),
		createAdapter: (transaction = false) =>
			dynamodbAdapter({
				documentClient: cluster.documentClient,
				tableNamePrefix: TABLE_NAME_PREFIX,
				scanMaxPages: SCAN_MAX_PAGES,
				transaction,
				...resolvers,
			})(options),
		isExpectedFailure: (reason, allowedCodes = []) =>
			isExpectedFailure(reason, [...profileFailureCodes(props.profile), ...allowedCodes]),
	};
};

const INJECTED_ERROR_NAMES = [
	"ProvisionedThroughputExceededException",
	"TimeoutError",
	"TransactionCanceledException",
];

/**
 * Whether an operation failed in a way chaos explains: an injected failure or
 * a transaction DynamoDB cancelled. An adapter error is a defect unless the
 * scenario names its code as a legitimate answer; that includes
 * ATOMIC_WRITE_CONTENTION, which a stale read alone must never cause.
 */
export const isExpectedFailure = (reason: unknown, allowedCodes: string[] = []): boolean => {
	if (reason instanceof DynamoDBAdapterError) {
		return allowedCodes.includes(reason.code);
	}
	if (reason instanceof Error) {
		return INJECTED_ERROR_NAMES.includes(reason.name);
	}
	return false;
};

export const describeFailure = (reason: unknown): string => {
	if (reason instanceof Error) {
		return `${reason.name}: ${reason.message}`;
	}
	return String(reason);
};

/**
 * Run one scenario for every seed under one profile and fail with everything
 * needed to replay the first run that broke an invariant.
 */
export type ChaosTotals = {
	runs: number;
	requests: number;
	staleReads: number;
	shortPages: number;
	partialBatches: number;
	rejected: number;
	lostResponses: number;
	resent: number;
	transactionConflicts: number;
};

export const runChaos = async (props: {
	profile: ChaosProfile;
	scenario: (environment: ChaosEnvironment) => Promise<string[]>;
	options?: BetterAuthOptions | undefined;
	/** Seeds to try instead of the default set (for scenarios that are slow per run). */
	seeds?: number[] | undefined;
}): Promise<ChaosTotals> => {
	const seeds = props.seeds ?? resolveSeeds();
	if (seeds.length === 0) {
		throw new Error("Chaos verification requires at least one seed.");
	}
	const totals: ChaosTotals = {
		runs: 0,
		requests: 0,
		staleReads: 0,
		shortPages: 0,
		partialBatches: 0,
		rejected: 0,
		lostResponses: 0,
		resent: 0,
		transactionConflicts: 0,
	};
	for (const seed of seeds) {
		const environment = createChaosEnvironment({
			seed,
			profile: props.profile,
			options: props.options,
		});
		const violations = await props.scenario(environment).catch((cause: unknown) => {
			throw new Error(
				[
					`Chaos scenario failed: ${describeFailure(cause)}`,
					`Replay with CHAOS_SEED=${seed} (profile "${props.profile.name}").`,
					"Requests, in the order they were answered:",
					...environment.cluster.trace.map((line) => `  ${line}`),
				].join("\n"),
				{ cause },
			);
		});
		const statistics = environment.cluster.statistics();
		totals.runs += 1;
		totals.requests += statistics.requests;
		totals.staleReads += statistics.staleReads;
		totals.shortPages += statistics.shortPages;
		totals.partialBatches += statistics.partialBatches;
		totals.rejected += statistics.rejected;
		totals.lostResponses += statistics.lostResponses;
		totals.resent += statistics.resent;
		totals.transactionConflicts += statistics.transactionConflicts;
		if (violations.length > 0) {
			throw new Error(
				[
					`Chaos run broke ${violations.length} invariant(s).`,
					`Replay with CHAOS_SEED=${seed} (profile "${props.profile.name}").`,
					...violations.map((violation) => `  - ${violation}`),
					"Requests, in the order they were answered:",
					...environment.cluster.trace.map((line) => `  ${line}`),
				].join("\n"),
			);
		}
	}
	return totals;
};

/**
 * A profile has to do what its name says, or a green run means nothing: the
 * faults it enables must have been injected at least once across the seeds.
 */
export const expectChaosHappened = (profile: ChaosProfile, totals: ChaosTotals): string[] => {
	if (totals.runs < 10) {
		// A replay of a single seed need not hit every kind of fault.
		return [];
	}
	const { faults } = profile;
	const expectations: Array<[boolean, number, string]> = [
		[faults.staleReadRate > 0, totals.staleReads, "stale reads"],
		[faults.rejectRate > 0, totals.rejected, "rejected requests"],
		[faults.lostResponseRate > 0, totals.lostResponses, "lost responses"],
		[faults.resendLostRequests, totals.resent, "re-sent requests"],
	];
	return expectations
		.filter(([enabled]) => enabled)
		.filter(([, count]) => count === 0)
		.map(([, , name]) => `profile "${profile.name}" never produced ${name}`);
};
