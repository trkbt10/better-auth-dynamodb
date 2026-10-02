/**
 * @file A DynamoDB stand-in that misbehaves the way a distributed database is
 * allowed to, for chaos specs.
 *
 * It wraps the in-memory fake (which is verified against DynamoDB Local) and
 * adds what a single local engine never shows:
 *
 * - replication lag: an eventually consistent read (every index read, and a
 *   table read without `ConsistentRead`) may be answered from an earlier
 *   state, each item lagging on its own;
 * - arbitrary interleaving: concurrent tasks advance one request at a time,
 *   in an order drawn from the seed;
 * - failures: a request rejected before it is applied (throttling), a write
 *   that is applied but whose response is lost (optionally re-sent, as the
 *   AWS SDK does), a transaction cancelled by a conflict.
 *
 * Everything is drawn from one seeded generator, so a failing run is replayed
 * from its seed.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import {
	BatchGetCommand,
	DeleteCommand,
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	TransactWriteCommand,
	UpdateCommand,
	type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import type { TableSchema } from "../../src/dynamodb/types";
import {
	createStatefulDocumentClient,
	type AppliedWrite,
} from "../stateful-document-client";
import { createSeededRandom, type SeededRandom } from "./seeded-random";

export type ChaosFaults = {
	/** Probability that an eventually consistent read is answered from lagging replicas. */
	staleReadRate: number;
	/** How many writes a lagging item can be behind. */
	maxLag: number;
	/** Whether the items of one stale read lag independently of each other. */
	fracturedReads: boolean;
	/** Probability that a request is rejected before it is applied. */
	rejectRate: number;
	/** Probability that a write is applied but its response is lost. */
	lostResponseRate: number;
	/** Whether a request with a lost response is sent again, as the AWS SDK retries. */
	resendLostRequests: boolean;
	/** Probability that a transaction is cancelled by a conflict before it is applied. */
	transactionConflictRate: number;
	/** Probability that a Query / Scan page is cut to one or two evaluated items. */
	shortPageRate: number;
	/** Probability that a BatchGetItem leaves some of its keys unprocessed. */
	unprocessedKeysRate: number;
};

export const NO_FAULTS: ChaosFaults = {
	staleReadRate: 0,
	maxLag: 0,
	fracturedReads: false,
	rejectRate: 0,
	lostResponseRate: 0,
	resendLostRequests: false,
	transactionConflictRate: 0,
	shortPageRate: 0,
	unprocessedKeysRate: 0,
};

/** A write the cluster applied, with the task that sent it. */
export type ChaosWrite = AppliedWrite & { task: number | undefined };

export type ChaosTaskFaults = {
	rejected: number;
	lostResponses: number;
	resent: number;
	transactionConflicts: number;
};

/** The requests the adapter sends. */
type ChaosCommand =
	| GetCommand
	| BatchGetCommand
	| QueryCommand
	| ScanCommand
	| PutCommand
	| UpdateCommand
	| DeleteCommand
	| TransactWriteCommand;

type PendingRequest = {
	task: number | undefined;
	command: ChaosCommand;
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
};

const COMMAND_KINDS = [
	GetCommand,
	BatchGetCommand,
	QueryCommand,
	ScanCommand,
	PutCommand,
	UpdateCommand,
	DeleteCommand,
	TransactWriteCommand,
];

const isChaosCommand = (command: unknown): command is ChaosCommand =>
	COMMAND_KINDS.some((kind) => command instanceof kind);

// One branch per command class: `send` is overloaded per command and does not
// accept their union.
const sendCommand = (client: DynamoDBDocumentClient, command: ChaosCommand): Promise<unknown> => {
	if (command instanceof GetCommand) {
		return client.send(command);
	}
	if (command instanceof BatchGetCommand) {
		return client.send(command);
	}
	if (command instanceof QueryCommand) {
		return client.send(command);
	}
	if (command instanceof ScanCommand) {
		return client.send(command);
	}
	if (command instanceof PutCommand) {
		return client.send(command);
	}
	if (command instanceof UpdateCommand) {
		return client.send(command);
	}
	if (command instanceof DeleteCommand) {
		return client.send(command);
	}
	return client.send(command);
};

const createNamedError = (name: string, message: string): Error => {
	const error = new Error(message);
	error.name = name;
	return error;
};

const WRITE_COMMANDS = [PutCommand, UpdateCommand, DeleteCommand, TransactWriteCommand];

const isWriteCommand = (command: unknown): boolean =>
	WRITE_COMMANDS.some((kind) => command instanceof kind);

// Which task of a run is executing. One storage serves every cluster: each
// AsyncLocalStorage instance adds a cost to every asynchronous step in the
// process, and a spec creates thousands of clusters.
const taskScope = new AsyncLocalStorage<number>();

const describeCommand = (command: unknown): string => {
	if (typeof command !== "object" || command === null) {
		return String(command);
	}
	const input = (command as { input?: Record<string, unknown> }).input ?? {};
	const target = [input.TableName, input.IndexName].filter((part) => part !== undefined).join("/");
	const key = input.Key === undefined ? "" : ` ${JSON.stringify(input.Key)}`;
	return `${command.constructor.name} ${target}${key}`;
};

/**
 * How long the scheduler waits, in milliseconds, for tasks that are busy
 * outside the database (hashing a password, for instance) before it calls
 * the run stalled.
 */
const MAX_IDLE_MILLISECONDS = 30000;

const nextTick = (): Promise<void> =>
	new Promise((resolve) => {
		setImmediate(resolve);
	});

const pause = (): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, 1);
	});

export const createChaosCluster = (props: {
	seed: number;
	faults: ChaosFaults;
	tableSchemas: TableSchema[];
	tableNamePrefix: string;
}) => {
	const random: SeededRandom = createSeededRandom(props.seed);
	const { faults } = props;
	const writes: ChaosWrite[] = [];
	const trace: string[] = [];
	const taskFaults = new Map<number, ChaosTaskFaults>();
	const afterWriteChecks: Array<(write: ChaosWrite) => void> = [];
	const afterRequestChecks: Array<() => void> = [];
	const state: {
		scheduling: boolean;
		/** The lag of the read being answered; `undefined` reads the current state. */
		readLag: { shared: number; used: boolean } | undefined;
		/** The task whose request is being answered. */
		currentTask: number | undefined;
		requests: number;
		/** Reads that were actually answered from an earlier state. */
		staleReads: number;
		shortPages: number;
		partialBatches: number;
	} = {
		scheduling: false,
		readLag: undefined,
		currentTask: undefined,
		requests: 0,
		staleReads: 0,
		shortPages: 0,
		partialBatches: 0,
	};
	const pending: PendingRequest[] = [];

	const faultsOf = (task: number | undefined): ChaosTaskFaults => {
		const key = task ?? -1;
		const existing = taskFaults.get(key);
		if (existing) {
			return existing;
		}
		const created = { rejected: 0, lostResponses: 0, resent: 0, transactionConflicts: 0 };
		taskFaults.set(key, created);
		return created;
	};

	const fake = createStatefulDocumentClient({
		tableSchemas: props.tableSchemas,
		tableNamePrefix: props.tableNamePrefix,
		replication: {
			historySize: Math.max(faults.maxLag, 1),
			resolveItemLag: () => {
				if (!state.readLag) {
					return 0;
				}
				state.readLag.used = true;
				if (faults.fracturedReads) {
					return random.int(faults.maxLag + 1);
				}
				return state.readLag.shared;
			},
		},
		onWrite: (write) => {
			const recorded = { ...write, task: state.currentTask };
			writes.push(recorded);
			afterWriteChecks.forEach((check) => check(recorded));
		},
	});
	const sendToFake = (command: ChaosCommand): Promise<unknown> =>
		sendCommand(fake.documentClient, command);

	const resolveReadLag = (): { shared: number; used: boolean } | undefined => {
		if (faults.maxLag === 0 || !random.chance(faults.staleReadRate)) {
			return undefined;
		}
		return { shared: random.int(faults.maxLag + 1), used: false };
	};

	// DynamoDB may end a page early. The page is cut to one or two evaluated
	// items, so the caller has to follow LastEvaluatedKey to get the rest.
	const resolveShortPageSize = (limit: number | undefined): number | undefined => {
		if (!random.chance(faults.shortPageRate)) {
			return undefined;
		}
		const pageSize = 1 + random.int(2);
		if (limit !== undefined && limit <= pageSize) {
			return undefined;
		}
		state.shortPages += 1;
		return pageSize;
	};

	const withShortPage = (command: ChaosCommand): ChaosCommand => {
		if (command instanceof QueryCommand) {
			const pageSize = resolveShortPageSize(command.input.Limit);
			return pageSize === undefined ? command : new QueryCommand({ ...command.input, Limit: pageSize });
		}
		if (command instanceof ScanCommand) {
			const pageSize = resolveShortPageSize(command.input.Limit);
			return pageSize === undefined ? command : new ScanCommand({ ...command.input, Limit: pageSize });
		}
		return command;
	};

	// DynamoDB may process only part of a BatchGetItem and hand the remaining
	// keys back as UnprocessedKeys.
	const sendPartialBatch = async (command: BatchGetCommand): Promise<unknown> => {
		state.partialBatches += 1;
		const requests = Object.entries(command.input.RequestItems ?? {}).map(([tableName, request]) => {
			const keys = request.Keys ?? [];
			const processed = random.int(keys.length);
			return {
				tableName,
				processed: { ...request, Keys: keys.slice(0, processed) },
				unprocessed: { ...request, Keys: keys.slice(processed) },
			};
		});
		const answered = requests.filter((request) => request.processed.Keys.length > 0);
		const unprocessedKeys = Object.fromEntries(
			requests.map((request) => [request.tableName, request.unprocessed]),
		);
		if (answered.length === 0) {
			return { Responses: {}, UnprocessedKeys: unprocessedKeys };
		}
		const output = (await sendToFake(
			new BatchGetCommand({
				RequestItems: Object.fromEntries(
					answered.map((request) => [request.tableName, request.processed]),
				),
			}),
		)) as { Responses?: Record<string, unknown> };
		return { Responses: output.Responses ?? {}, UnprocessedKeys: unprocessedKeys };
	};

	const sendToCluster = (command: ChaosCommand): Promise<unknown> => {
		if (command instanceof BatchGetCommand && random.chance(faults.unprocessedKeysRate)) {
			return sendPartialBatch(command);
		}
		return sendToFake(withShortPage(command));
	};

	const sendOnce = async (request: PendingRequest): Promise<unknown> => {
		const readLag = resolveReadLag();
		state.readLag = readLag;
		state.currentTask = request.task;
		try {
			return await sendToCluster(request.command);
		} finally {
			if (readLag?.used) {
				state.staleReads += 1;
			}
			state.readLag = undefined;
			state.currentTask = undefined;
		}
	};

	// Decide the fate of one request. The draws happen in a fixed order, so
	// the same seed always produces the same run.
	const execute = async (request: PendingRequest): Promise<unknown> => {
		const counters = faultsOf(request.task);
		if (random.chance(faults.rejectRate)) {
			counters.rejected += 1;
			throw createNamedError(
				"ProvisionedThroughputExceededException",
				"Chaos: the request was rejected before it was applied.",
			);
		}
		const isTransaction = request.command instanceof TransactWriteCommand;
		if (isTransaction && random.chance(faults.transactionConflictRate)) {
			counters.transactionConflicts += 1;
			throw createNamedError(
				"TransactionCanceledException",
				"Chaos: Transaction cancelled, please refer cancellation reasons for specific reasons [TransactionConflict]",
			);
		}
		const result = await sendOnce(request);
		if (!isWriteCommand(request.command) || !random.chance(faults.lostResponseRate)) {
			return result;
		}
		counters.lostResponses += 1;
		if (!faults.resendLostRequests) {
			throw createNamedError(
				"TimeoutError",
				"Chaos: the write was applied but its response was lost.",
			);
		}
		counters.resent += 1;
		return sendOnce(request);
	};

	const settleRequest = async (request: PendingRequest, index: number): Promise<void> => {
		const label = `#${index} task=${request.task ?? "-"} ${describeCommand(request.command)}`;
		try {
			const result = await execute(request);
			trace.push(`${label} -> ok`);
			request.resolve(result);
		} catch (error) {
			trace.push(`${label} -> ${error instanceof Error ? error.name : String(error)}`);
			request.reject(error);
		}
	};

	const chaoticSend = (command: unknown): Promise<unknown> => {
		if (!isChaosCommand(command)) {
			throw new Error(`Chaos cluster: unsupported command ${describeCommand(command)}.`);
		}
		const task = taskScope.getStore();
		if (!state.scheduling) {
			// Outside a run (setup, inspection) requests are answered at once,
			// without faults.
			return sendToFake(command);
		}
		return new Promise((resolve, reject) => {
			pending.push({ task, command, resolve, reject });
		});
	};

	const documentClient = fake.documentClient;
	const chaoticClientSend: DynamoDBDocumentClient["send"] = (command: unknown) => chaoticSend(command);
	// The adapter under test talks to this client: the fake's own client object
	// with its `send` replaced by the scheduled, fault-injecting one.
	const chaosDocumentClient: DynamoDBDocumentClient = Object.create(documentClient, {
		send: { value: chaoticClientSend },
	});

	/**
	 * Run tasks concurrently. Whenever every running task waits for the
	 * database, one waiting request is picked from the seed and answered.
	 */
	const run = async <T>(
		tasks: Array<() => Promise<T>>,
	): Promise<PromiseSettledResult<T>[]> => {
		if (state.scheduling) {
			throw new Error("A chaos run is already in progress.");
		}
		state.scheduling = true;
		const progress: { running: number; idleSince: number | undefined } = {
			running: tasks.length,
			idleSince: undefined,
		};
		const outcomes = tasks.map((task, index) =>
			taskScope.run(index, async (): Promise<PromiseSettledResult<T>> => {
				try {
					return { status: "fulfilled", value: await task() };
				} catch (reason) {
					return { status: "rejected", reason };
				} finally {
					progress.running -= 1;
				}
			}),
		);
		try {
			for (;;) {
				await nextTick();
				if (progress.running === 0 && pending.length === 0) {
					break;
				}
				if (pending.length === 0) {
					const idleSince = progress.idleSince ?? Date.now();
					progress.idleSince = idleSince;
					if (Date.now() - idleSince > MAX_IDLE_MILLISECONDS) {
						throw new Error("Chaos run stalled: tasks are neither finished nor waiting for the database.");
					}
					await pause();
					continue;
				}
				progress.idleSince = undefined;
				const [request] = pending.splice(random.int(pending.length), 1);
				state.requests += 1;
				await settleRequest(request, state.requests);
				afterRequestChecks.forEach((check) => check());
			}
		} finally {
			state.scheduling = false;
		}
		return Promise.all(outcomes);
	};

	return {
		random,
		documentClient: chaosDocumentClient,
		store: fake.store,
		/** Let every replica catch up, e.g. after seeding the tables. */
		settle: fake.settleReplication,
		run,
		writes,
		trace,
		faultsOf,
		/** What the run did, summed over its tasks. */
		statistics: () => {
			const perTask = Array.from(taskFaults.values());
			const sum = (pick: (faults: ChaosTaskFaults) => number): number =>
				perTask.reduce((total, entry) => total + pick(entry), 0);
			return {
				requests: state.requests,
				staleReads: state.staleReads,
				shortPages: state.shortPages,
				partialBatches: state.partialBatches,
				rejected: sum((entry) => entry.rejected),
				lostResponses: sum((entry) => entry.lostResponses),
				resent: sum((entry) => entry.resent),
				transactionConflicts: sum((entry) => entry.transactionConflicts),
			};
		},
		/** Check an invariant right after every applied write. */
		afterWrite: (check: (write: ChaosWrite) => void): void => {
			afterWriteChecks.push(check);
		},
		/**
		 * Check an invariant after every answered request, i.e. between two
		 * requests, where a transaction is either applied in full or not at all.
		 */
		afterRequest: (check: () => void): void => {
			afterRequestChecks.push(check);
		},
	};
};

export type ChaosCluster = ReturnType<typeof createChaosCluster>;
