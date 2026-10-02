/**
 * @file Integration tests for the native atomic methods (consumeOne /
 * incrementOne) against DynamoDB Local.
 *
 * Conditional writes are the whole point of these methods, so they are
 * exercised against a real DynamoDB engine rather than an in-memory fake.
 */
import {
	DeleteCommand,
	UpdateCommand,
	type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import type { BetterAuthOptions } from "@better-auth/core";
import type {
	DBAdapter,
	DBTransactionAdapter,
} from "@better-auth/core/db/adapter";
import { applyTableSchemas } from "../src/apply-table-schemas";
import { dynamodbAdapter } from "../src/adapter";
import { DynamoDBAdapterError } from "../src/dynamodb/errors/errors";
import {
	createIndexResolversFromSchemas,
	generateTableSchemas,
} from "../src/table-schemas";
import {
	buildTestConfig,
	createTestClients,
	deleteTables,
	tableNamesFromSchemas,
} from "./adapter-test-helpers";

type VerificationRow = {
	id: string;
	identifier: string;
	value: string;
};

type UserRow = {
	id: string;
	email: string;
	name: string;
	loginCount?: number | null;
	nickname?: string | null;
};

type AtomicAdapter = DBTransactionAdapter<BetterAuthOptions>;

const testConfig = buildTestConfig({
	endpoint: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
	accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "fakeAccessKeyId",
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "fakeSecretAccessKey",
});

const options: BetterAuthOptions = {
	user: {
		additionalFields: {
			loginCount: { type: "number", required: false },
			nickname: { type: "string", required: false },
		},
	},
};

const schemas = generateTableSchemas(options);
const resolvers = createIndexResolversFromSchemas(schemas);
const { client, documentClient } = createTestClients(testConfig);

const createTables = (tableNamePrefix: string) =>
	schemas.map((schema) => ({
		...schema,
		tableName: `${tableNamePrefix}${schema.tableName}`,
	}));

const createAdapter = (props: {
	documentClient: DynamoDBDocumentClient;
	tableNamePrefix: string;
	transaction: boolean;
}): DBAdapter<BetterAuthOptions> =>
	dynamodbAdapter({
		documentClient: props.documentClient,
		tableNamePrefix: props.tableNamePrefix,
		scanMaxPages: 25,
		indexNameResolver: resolvers.indexNameResolver,
		indexKeySchemaResolver: resolvers.indexKeySchemaResolver,
		transaction: props.transaction,
	})(options);

/**
 * A document client that runs `interfere` right before the first command
 * accepted by `shouldInterfere` is sent. It reproduces a concurrent writer
 * that gets in between the adapter's read and its conditional write.
 */
const createInterleavingClient = <TCommand>(props: {
	shouldInterfere: (command: unknown) => command is TCommand;
	interfere: (command: TCommand) => Promise<void>;
}): { documentClient: DynamoDBDocumentClient; interferences: () => number } => {
	const { documentClient: racingClient } = createTestClients(testConfig);
	const state = { interferences: 0 };
	const send = racingClient.send.bind(racingClient);
	const sendHandler: DynamoDBDocumentClient["send"] = async (
		command: Parameters<typeof send>[0],
	) => {
		if (state.interferences === 0 && props.shouldInterfere(command)) {
			state.interferences += 1;
			await props.interfere(command);
		}
		return send(command);
	};
	racingClient.send = sendHandler;
	return {
		documentClient: racingClient,
		interferences: () => state.interferences,
	};
};

const isDeleteCommand = (command: unknown): command is DeleteCommand =>
	command instanceof DeleteCommand;

const isUpdateCommand = (command: unknown): command is UpdateCommand =>
	command instanceof UpdateCommand;

const captureAsyncError = async (fn: () => Promise<unknown>): Promise<unknown> => {
	try {
		await fn();
	} catch (error) {
		return error;
	}
	return undefined;
};

const createSequence = () => {
	const state = { value: 0 };
	return (): number => {
		state.value += 1;
		return state.value;
	};
};

const nextSequence = createSequence();

for (const transaction of [false, true]) {
	describe(`atomic methods on DynamoDB Local (transaction: ${transaction})`, () => {
		const tableNamePrefix = `atomic_methods_${transaction}_`;
		const tables = createTables(tableNamePrefix);
		const userTable = `${tableNamePrefix}user`;
		const adapter = createAdapter({
			documentClient,
			tableNamePrefix,
			transaction,
		});

		// With adapter transactions enabled every call under test runs inside
		// its own transaction, so the buffered (commit-time) path is exercised.
		const run = <T>(fn: (target: AtomicAdapter) => Promise<T>): Promise<T> => {
			if (transaction) {
				return adapter.transaction(fn);
			}
			return fn(adapter);
		};

		const createVerification = async (
			identifier: string,
			value = "v",
		): Promise<VerificationRow> =>
			adapter.create<Record<string, unknown>, VerificationRow>({
				model: "verification",
				data: {
					identifier,
					value,
					expiresAt: new Date("2100-01-01T00:00:00.000Z"),
				},
			});

		const createUser = async (
			fields: Record<string, unknown> = {},
		): Promise<UserRow> =>
			adapter.create<Record<string, unknown>, UserRow>({
				model: "user",
				data: {
					name: "user",
					email: `user-${nextSequence()}@example.com`,
					...fields,
				},
			});

		const findVerification = (id: string) =>
			adapter.findOne<VerificationRow>({
				model: "verification",
				where: [{ field: "id", value: id }],
			});

		const findUser = (id: string) =>
			adapter.findOne<UserRow>({
				model: "user",
				where: [{ field: "id", value: id }],
			});

		beforeAll(async () => {
			await applyTableSchemas({ client, tables });
		});

		afterAll(async () => {
			await deleteTables({
				client,
				tableNames: tableNamesFromSchemas(tables),
			});
		});

		describe("consumeOne", () => {
			test("returns the row and deletes it", async () => {
				const created = await createVerification("consume-basic");

				const consumed = await run((target) =>
					target.consumeOne<VerificationRow>({
						model: "verification",
						where: [{ field: "id", value: created.id }],
					}),
				);

				expect(consumed).toMatchObject({
					id: created.id,
					identifier: "consume-basic",
					value: "v",
				});
				expect(await findVerification(created.id)).toBeNull();
			});

			test("returns null when no row matches", async () => {
				const consumed = await run((target) =>
					target.consumeOne({
						model: "verification",
						where: [{ field: "id", value: "missing-id" }],
					}),
				);

				expect(consumed).toBeNull();
			});

			test("hands the row to exactly one of several concurrent callers", async () => {
				const created = await createVerification("consume-race");
				const where = [{ field: "id", value: created.id }];

				const attempts = await Promise.allSettled(
					Array.from({ length: 8 }, () =>
						run((target) =>
							target.consumeOne<VerificationRow>({
								model: "verification",
								where,
							}),
						),
					),
				);

				// Without adapter transactions every loser gets `null`. With them,
				// a loser either reads nothing or has its commit cancelled.
				const winners = attempts.filter((attempt) => {
					if (attempt.status !== "fulfilled") {
						return false;
					}
					return attempt.value !== null;
				});
				expect(winners).toHaveLength(1);
				expect(
					await run((target) =>
						target.consumeOne({ model: "verification", where }),
					),
				).toBeNull();
			});

			test("accepts a where clause that repeats the primary key condition", async () => {
				const created = await createVerification("consume-duplicate-pk");

				const consumed = await run((target) =>
					target.consumeOne<VerificationRow>({
						model: "verification",
						where: [
							{ field: "id", value: created.id },
							{ field: "id", value: created.id },
							{ field: "identifier", value: "consume-duplicate-pk" },
						],
					}),
				);

				expect(consumed?.id).toBe(created.id);
				expect(await findVerification(created.id)).toBeNull();
			});

			test("does not consume a row whose guard does not match", async () => {
				const created = await createVerification("consume-guard", "changed");

				const consumed = await run((target) =>
					target.consumeOne({
						model: "verification",
						where: [
							{ field: "id", value: created.id },
							{ field: "value", value: "v" },
						],
					}),
				);

				expect(consumed).toBeNull();
				expect(await findVerification(created.id)).not.toBeNull();
			});

			test("deletes one row per call for a non-unique predicate", async () => {
				const identifier = "consume-many";
				const first = await createVerification(identifier);
				const second = await createVerification(identifier);
				const where = [{ field: "identifier", value: identifier }];
				const consume = () =>
					run((target) =>
						target.consumeOne<VerificationRow>({
							model: "verification",
							where,
						}),
					);

				const consumedFirst = await consume();
				const remaining = await adapter.findMany<VerificationRow>({
					model: "verification",
					where,
				});
				const consumedSecond = await consume();
				const consumedThird = await consume();

				expect(remaining).toHaveLength(1);
				expect([consumedFirst?.id, consumedSecond?.id].sort()).toEqual(
					[first.id, second.id].sort(),
				);
				expect(consumedThird).toBeNull();
			});

			test("supports an operator DynamoDB cannot evaluate (ends_with)", async () => {
				const created = await createVerification("consume-suffix-xyz");

				const miss = await run((target) =>
					target.consumeOne({
						model: "verification",
						where: [
							{ field: "id", value: created.id },
							{ field: "identifier", operator: "ends_with", value: "-abc" },
						],
					}),
				);
				const hit = await run((target) =>
					target.consumeOne<VerificationRow>({
						model: "verification",
						where: [
							{ field: "id", value: created.id },
							{ field: "identifier", operator: "ends_with", value: "-xyz" },
						],
					}),
				);

				expect(miss).toBeNull();
				expect(hit?.id).toBe(created.id);
				expect(await findVerification(created.id)).toBeNull();
			});
		});

		describe("incrementOne", () => {
			test("adds the delta to an existing counter and returns the updated row", async () => {
				const user = await createUser({ loginCount: 1 });

				const updated = await run((target) =>
					target.incrementOne<UserRow>({
						model: "user",
						where: [{ field: "id", value: user.id }],
						increment: { loginCount: 2 },
					}),
				);

				expect(updated).toMatchObject({ id: user.id, loginCount: 3 });
				expect((await findUser(user.id))?.loginCount).toBe(3);
			});

			test("treats an absent counter as 0", async () => {
				const user = await createUser();

				const updated = await run((target) =>
					target.incrementOne<UserRow>({
						model: "user",
						where: [{ field: "id", value: user.id }],
						increment: { loginCount: 1 },
					}),
				);

				expect(updated?.loginCount).toBe(1);
				expect((await findUser(user.id))?.loginCount).toBe(1);
			});

			test("treats a null counter as 0", async () => {
				const user = await createUser();
				await documentClient.send(
					new UpdateCommand({
						TableName: userTable,
						Key: { id: user.id },
						UpdateExpression: "SET #c = :null",
						ExpressionAttributeNames: { "#c": "loginCount" },
						ExpressionAttributeValues: { ":null": null },
					}),
				);

				const updated = await run((target) =>
					target.incrementOne<UserRow>({
						model: "user",
						where: [{ field: "id", value: user.id }],
						increment: { loginCount: 4 },
					}),
				);

				expect(updated?.loginCount).toBe(4);
				expect((await findUser(user.id))?.loginCount).toBe(4);
			});

			test("returns null and leaves the row untouched when the guard misses", async () => {
				const user = await createUser({ loginCount: 5 });

				const updated = await run((target) =>
					target.incrementOne({
						model: "user",
						where: [
							{ field: "id", value: user.id },
							{ field: "loginCount", operator: "lt", value: 5 },
						],
						increment: { loginCount: 1 },
					}),
				);

				expect(updated).toBeNull();
				expect((await findUser(user.id))?.loginCount).toBe(5);
			});

			test("applies a negative delta under a gte guard", async () => {
				const user = await createUser({ loginCount: 3 });
				const release = () =>
					run((target) =>
						target.incrementOne<UserRow>({
							model: "user",
							where: [
								{ field: "id", value: user.id },
								{ field: "loginCount", operator: "gte", value: 2 },
							],
							increment: { loginCount: -2 },
						}),
					);

				const first = await release();
				const second = await release();

				expect(first?.loginCount).toBe(1);
				expect(second).toBeNull();
				expect((await findUser(user.id))?.loginCount).toBe(1);
			});

			test("assigns set values together with the increment, including null", async () => {
				const user = await createUser({ loginCount: 1, nickname: "before" });

				const renamed = await run((target) =>
					target.incrementOne<UserRow>({
						model: "user",
						where: [{ field: "id", value: user.id }],
						increment: { loginCount: 1 },
						set: { nickname: "after" },
					}),
				);
				const cleared = await run((target) =>
					target.incrementOne<UserRow>({
						model: "user",
						where: [
							{ field: "id", value: user.id },
							{ field: "nickname", value: "after" },
						],
						increment: {},
						set: { nickname: null },
					}),
				);

				expect(renamed).toMatchObject({ loginCount: 2, nickname: "after" });
				expect(cleared).toMatchObject({ loginCount: 2 });
				expect(cleared?.nickname).toBeNull();
				expect((await findUser(user.id))?.nickname).toBeNull();
			});

			test("selects the row through a secondary index when the key is not given", async () => {
				const user = await createUser({ loginCount: 10 });

				const updated = await run((target) =>
					target.incrementOne<UserRow>({
						model: "user",
						where: [{ field: "email", value: user.email }],
						increment: { loginCount: 1 },
					}),
				);

				expect(updated).toMatchObject({ id: user.id, loginCount: 11 });
				expect((await findUser(user.id))?.loginCount).toBe(11);
			});

			test("rejects a counter that holds a non-numeric value", async () => {
				const user = await createUser({ nickname: "text" });

				const error = await captureAsyncError(() =>
					run((target) =>
						target.incrementOne({
							model: "user",
							where: [{ field: "id", value: user.id }],
							increment: { nickname: 1 },
						}),
					),
				);

				expect(error).toBeInstanceOf(DynamoDBAdapterError);
				expect((await findUser(user.id))?.nickname).toBe("text");
			});
		});
	});
}

describe("atomic methods under contention (transaction: false)", () => {
	const tableNamePrefix = "atomic_contention_";
	const tables = createTables(tableNamePrefix);
	const verificationTable = `${tableNamePrefix}verification`;
	const userTable = `${tableNamePrefix}user`;
	const createContentionAdapter = (
		target: DynamoDBDocumentClient,
	): DBAdapter<BetterAuthOptions> =>
		createAdapter({
			documentClient: target,
			tableNamePrefix,
			transaction: false,
		});
	const adapter = createContentionAdapter(documentClient);

	const createVerification = async (
		identifier: string,
	): Promise<VerificationRow> =>
		adapter.create<Record<string, unknown>, VerificationRow>({
			model: "verification",
			data: {
				identifier,
				value: "v",
				expiresAt: new Date("2100-01-01T00:00:00.000Z"),
			},
		});

	const createUser = async (
		fields: Record<string, unknown>,
	): Promise<UserRow> =>
		adapter.create<Record<string, unknown>, UserRow>({
			model: "user",
			data: { name: "user", ...fields },
		});

	const findUser = (id: string) =>
		adapter.findOne<UserRow>({
			model: "user",
			where: [{ field: "id", value: id }],
		});

	beforeAll(async () => {
		await applyTableSchemas({ client, tables });
	});

	afterAll(async () => {
		await deleteTables({ client, tableNames: tableNamesFromSchemas(tables) });
	});

	test("consumeOne does not consume a row that stops matching between the read and the delete", async () => {
		const created = await createVerification("contention-guard");
		const racing = createInterleavingClient({
			shouldInterfere: isDeleteCommand,
			interfere: async () => {
				await documentClient.send(
					new UpdateCommand({
						TableName: verificationTable,
						Key: { id: created.id },
						UpdateExpression: "SET #v = :v",
						ExpressionAttributeNames: { "#v": "value" },
						ExpressionAttributeValues: { ":v": "changed" },
					}),
				);
			},
		});

		const consumed = await createContentionAdapter(
			racing.documentClient,
		).consumeOne({
			model: "verification",
			where: [
				{ field: "identifier", value: "contention-guard" },
				{ field: "value", value: "v" },
			],
		});

		expect(racing.interferences()).toBe(1);
		expect(consumed).toBeNull();
		expect(
			await adapter.findOne<VerificationRow>({
				model: "verification",
				where: [{ field: "id", value: created.id }],
			}),
		).toMatchObject({ value: "changed" });
	});

	test("consumeOne moves on to another matching row when its candidate is taken", async () => {
		const first = await createVerification("contention-retry");
		const second = await createVerification("contention-retry");
		const stolen: unknown[] = [];
		const racing = createInterleavingClient({
			shouldInterfere: isDeleteCommand,
			// Another consumer deletes the very row the adapter is about to delete.
			interfere: async (command) => {
				stolen.push(command.input.Key?.id);
				await documentClient.send(
					new DeleteCommand({
						TableName: verificationTable,
						Key: command.input.Key,
					}),
				);
			},
		});

		const consumed = await createContentionAdapter(
			racing.documentClient,
		).consumeOne<VerificationRow>({
			model: "verification",
			where: [{ field: "identifier", value: "contention-retry" }],
		});

		expect(stolen).toHaveLength(1);
		expect([first.id, second.id]).toContain(stolen[0]);
		expect([first.id, second.id]).toContain(consumed?.id);
		expect(consumed?.id).not.toBe(stolen[0]);
		expect(
			await adapter.findMany({
				model: "verification",
				where: [{ field: "identifier", value: "contention-retry" }],
			}),
		).toHaveLength(0);
	});

	test("incrementOne never lets concurrent callers pass a guarded limit", async () => {
		const user = await createUser({ email: "seats@example.com", loginCount: 0 });
		const limit = 10;

		const attempts = await Promise.all(
			Array.from({ length: 25 }, () =>
				adapter.incrementOne<UserRow>({
					model: "user",
					where: [
						{ field: "id", value: user.id },
						{ field: "loginCount", operator: "lt", value: limit },
					],
					increment: { loginCount: 1 },
				}),
			),
		);

		const granted = attempts
			.filter((attempt) => attempt !== null)
			.map((attempt) => attempt.loginCount ?? 0)
			.sort((left, right) => left - right);
		expect(granted).toEqual(
			Array.from({ length: limit }, (_, index) => index + 1),
		);
		expect((await findUser(user.id))?.loginCount).toBe(limit);
	});

	test("incrementOne does not lose concurrent unguarded increments", async () => {
		const user = await createUser({ email: "counter@example.com" });

		const attempts = await Promise.all(
			Array.from({ length: 30 }, () =>
				adapter.incrementOne<UserRow>({
					model: "user",
					where: [{ field: "email", value: "counter@example.com" }],
					increment: { loginCount: 1 },
				}),
			),
		);

		expect(attempts.filter((attempt) => attempt === null)).toHaveLength(0);
		expect((await findUser(user.id))?.loginCount).toBe(30);
	});

	test("incrementOne re-evaluates the guard when the row changes after it was read", async () => {
		const user = await createUser({ email: "guard@example.com", loginCount: 9 });
		const racing = createInterleavingClient({
			shouldInterfere: isUpdateCommand,
			interfere: async () => {
				await documentClient.send(
					new UpdateCommand({
						TableName: userTable,
						Key: { id: user.id },
						UpdateExpression: "SET #c = :c",
						ExpressionAttributeNames: { "#c": "loginCount" },
						ExpressionAttributeValues: { ":c": 10 },
					}),
				);
			},
		});

		const updated = await createContentionAdapter(
			racing.documentClient,
		).incrementOne({
			model: "user",
			where: [
				{ field: "id", value: user.id },
				{ field: "loginCount", operator: "lt", value: 10 },
			],
			increment: { loginCount: 1 },
		});

		expect(racing.interferences()).toBe(1);
		expect(updated).toBeNull();
		expect((await findUser(user.id))?.loginCount).toBe(10);
	});

	test("incrementOne switches expression when a counter turns null after it was read", async () => {
		const user = await createUser({ email: "null-turn@example.com", loginCount: 7 });
		const racing = createInterleavingClient({
			shouldInterfere: isUpdateCommand,
			interfere: async () => {
				await documentClient.send(
					new UpdateCommand({
						TableName: userTable,
						Key: { id: user.id },
						UpdateExpression: "SET #c = :null",
						ExpressionAttributeNames: { "#c": "loginCount" },
						ExpressionAttributeValues: { ":null": null },
					}),
				);
			},
		});

		const updated = await createContentionAdapter(
			racing.documentClient,
		).incrementOne<UserRow>({
			model: "user",
			where: [{ field: "id", value: user.id }],
			increment: { loginCount: 2 },
		});

		expect(racing.interferences()).toBe(1);
		expect(updated?.loginCount).toBe(2);
		expect((await findUser(user.id))?.loginCount).toBe(2);
	});
});

describe("atomic methods inside one adapter transaction", () => {
	const tableNamePrefix = "atomic_transaction_";
	const tables = createTables(tableNamePrefix);
	const userTable = `${tableNamePrefix}user`;
	const adapter = createAdapter({
		documentClient,
		tableNamePrefix,
		transaction: true,
	});

	const createVerification = async (
		identifier: string,
	): Promise<VerificationRow> =>
		adapter.create<Record<string, unknown>, VerificationRow>({
			model: "verification",
			data: {
				identifier,
				value: "v",
				expiresAt: new Date("2100-01-01T00:00:00.000Z"),
			},
		});

	const findVerifications = (identifier: string) =>
		adapter.findMany<VerificationRow>({
			model: "verification",
			where: [{ field: "identifier", value: identifier }],
		});

	beforeAll(async () => {
		await applyTableSchemas({ client, tables });
	});

	afterAll(async () => {
		await deleteTables({ client, tableNames: tableNamesFromSchemas(tables) });
	});

	test("a row consumed earlier in the transaction cannot be consumed again", async () => {
		const created = await createVerification("transaction-twice");
		const where = [{ field: "id", value: created.id }];

		const [first, second] = await adapter.transaction(async (tx) => [
			await tx.consumeOne<VerificationRow>({ model: "verification", where }),
			await tx.consumeOne<VerificationRow>({ model: "verification", where }),
		]);

		expect(first?.id).toBe(created.id);
		expect(second).toBeNull();
		expect(await findVerifications("transaction-twice")).toHaveLength(0);
	});

	test("commits a consume followed by a deleteMany that covers the same row", async () => {
		// Better Auth consumes a verification by id and then clears every row
		// sharing its identifier, all inside one adapter transaction.
		const latest = await createVerification("transaction-sweep");
		await createVerification("transaction-sweep");

		const consumed = await adapter.transaction(async (tx) => {
			const row = await tx.consumeOne<VerificationRow>({
				model: "verification",
				where: [{ field: "id", value: latest.id }],
			});
			await tx.deleteMany({
				model: "verification",
				where: [{ field: "identifier", value: "transaction-sweep" }],
			});
			return row;
		});

		expect(consumed?.id).toBe(latest.id);
		expect(await findVerifications("transaction-sweep")).toHaveLength(0);
	});

	test("cancels the commit when the consumed row changed after it was read", async () => {
		const created = await createVerification("transaction-stale");

		const error = await captureAsyncError(() =>
			adapter.transaction(async (tx) => {
				const row = await tx.consumeOne<VerificationRow>({
					model: "verification",
					where: [{ field: "id", value: created.id }],
				});
				await adapter.update({
					model: "verification",
					where: [{ field: "id", value: created.id }],
					update: { value: "changed" },
				});
				return row;
			}),
		);

		expect(error).toBeInstanceOf(Error);
		expect(error).toMatchObject({ name: "TransactionCanceledException" });
		expect(await findVerifications("transaction-stale")).toHaveLength(1);
	});

	test("cancels the commit when a counter moved after the increment was computed", async () => {
		const user = await adapter.create<Record<string, unknown>, UserRow>({
			model: "user",
			data: { name: "user", email: "transaction-counter@example.com", loginCount: 1 },
		});

		const error = await captureAsyncError(() =>
			adapter.transaction(async (tx) => {
				const row = await tx.incrementOne<UserRow>({
					model: "user",
					where: [{ field: "id", value: user.id }],
					increment: { loginCount: 1 },
				});
				await documentClient.send(
					new UpdateCommand({
						TableName: userTable,
						Key: { id: user.id },
						UpdateExpression: "SET #c = :c",
						ExpressionAttributeNames: { "#c": "loginCount" },
						ExpressionAttributeValues: { ":c": 5 },
					}),
				);
				return row;
			}),
		);

		expect(error).toMatchObject({ name: "TransactionCanceledException" });
		expect(
			await adapter.findOne<UserRow>({
				model: "user",
				where: [{ field: "id", value: user.id }],
			}),
		).toMatchObject({ loginCount: 5 });
	});
});
