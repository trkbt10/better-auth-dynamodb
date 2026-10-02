/**
 * @file Write semantics against DynamoDB Local: duplicate primary keys, rows
 * that disappear between a read and a write, and reads inside a transaction.
 */
import {
	DeleteCommand,
	ScanCommand,
	UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "@better-auth/core";
import { DynamoDBAdapterError } from "../src/dynamodb/errors/errors";
import {
	captureAsyncError,
	createInterleavingClient,
	createLocalEnvironment,
	localClients,
} from "./dynamodb-local-environment";

type UserRow = {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
};

type SessionRow = { id: string; userId: string; token: string };

const options: BetterAuthOptions = {
	secret: "test-secret-at-least-32-characters-long!!",
	baseURL: "http://localhost:3000",
	user: {
		additionalFields: {
			loginCount: { type: "number", required: false },
			nickname: { type: "string", required: false },
			tags: { type: "string[]", required: false },
			prefs: { type: "json", required: false },
		},
	},
};

const isUpdateCommand = (command: unknown): command is UpdateCommand =>
	command instanceof UpdateCommand;

const isDeleteCommand = (command: unknown): command is DeleteCommand =>
	command instanceof DeleteCommand;

describe("single-row writes on DynamoDB Local", () => {
	const environment = createLocalEnvironment({
		tableNamePrefix: "write_semantics_",
		options,
	});
	const adapter = environment.createAdapter();
	const { documentClient } = localClients;

	const createUser = (data: Record<string, unknown>): Promise<UserRow> =>
		adapter.create<Record<string, unknown>, UserRow>({
			model: "user",
			data: { name: "user", ...data },
			forceAllowId: true,
		});

	const findUser = (id: string) =>
		adapter.findOne<UserRow>({ model: "user", where: [{ field: "id", value: id }] });

	const scanUsers = async (email: string) => {
		const output = await documentClient.send(
			new ScanCommand({
				TableName: environment.tableName("user"),
				FilterExpression: "#e = :e",
				ExpressionAttributeNames: { "#e": "email" },
				ExpressionAttributeValues: { ":e": email },
			}),
		);
		return output.Items ?? [];
	};

	beforeAll(environment.setUp);
	afterAll(environment.tearDown);

	test("create rejects a primary key that is taken and keeps the stored row", async () => {
		await createUser({ id: "duplicate", name: "first", email: "first@example.com" });

		const error = await captureAsyncError(() =>
			createUser({ id: "duplicate", name: "second", email: "second@example.com" }),
		);

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		expect(error).toMatchObject({ code: "DUPLICATE_PRIMARY_KEY" });
		expect(await findUser("duplicate")).toMatchObject({ name: "first" });
	});

	test("create hands a deterministic id to exactly one of several concurrent callers", async () => {
		const attempts = await Promise.allSettled(
			Array.from({ length: 8 }, (_, index) =>
				createUser({ id: "raced", name: `caller-${index}`, email: "raced@example.com" }),
			),
		);

		expect(
			attempts.filter((attempt) => attempt.status === "fulfilled"),
		).toHaveLength(1);
		expect(await scanUsers("raced@example.com")).toHaveLength(1);
	});

	test("Better Auth reserves a verification value once", async () => {
		const auth = betterAuth({ ...options, database: () => adapter });
		const { internalAdapter } = await auth.$context;
		const reserve = () =>
			internalAdapter.reserveVerificationValue({
				identifier: "replay-tombstone",
				value: "seen",
				expiresAt: new Date("2100-01-01T00:00:00.000Z"),
			});

		const first = await reserve();
		const second = await reserve();
		const raced = await Promise.all(
			Array.from({ length: 6 }, () =>
				internalAdapter.reserveVerificationValue({
					identifier: "replay-tombstone-raced",
					value: "seen",
					expiresAt: new Date("2100-01-01T00:00:00.000Z"),
				}),
			),
		);

		expect(first).toBe(true);
		expect(second).toBe(false);
		expect(raced.filter((reserved) => reserved)).toHaveLength(1);
	});

	test("update does not resurrect a row that was deleted after it was read", async () => {
		const user = await createUser({ email: "vanish@example.com" });
		const racing = createInterleavingClient({
			shouldInterfere: isUpdateCommand,
			interfere: async () => {
				await documentClient.send(
					new DeleteCommand({
						TableName: environment.tableName("user"),
						Key: { id: user.id },
					}),
				);
			},
		});

		const updated = await environment
			.createAdapter({ documentClient: racing.documentClient })
			.update({
				model: "user",
				where: [{ field: "id", value: user.id }],
				update: { name: "ghost" },
			});

		expect(racing.interferences()).toBe(1);
		expect(updated).toBeNull();
		expect(await findUser(user.id)).toBeNull();
		expect(await scanUsers("vanish@example.com")).toHaveLength(0);
	});

	test("update sets a number to the given value, whatever was written in between", async () => {
		const user = await createUser({ email: "absolute@example.com", loginCount: 2 });
		const racing = createInterleavingClient({
			shouldInterfere: isUpdateCommand,
			interfere: async () => {
				await documentClient.send(
					new UpdateCommand({
						TableName: environment.tableName("user"),
						Key: { id: user.id },
						UpdateExpression: "SET #c = :c",
						ExpressionAttributeNames: { "#c": "loginCount" },
						ExpressionAttributeValues: { ":c": 10 },
					}),
				);
			},
		});

		const updated = await environment
			.createAdapter({ documentClient: racing.documentClient })
			.update<UserRow & { loginCount: number }>({
				model: "user",
				where: [{ field: "id", value: user.id }],
				update: { loginCount: 5 },
			});

		expect(racing.interferences()).toBe(1);
		expect(updated?.loginCount).toBe(5);
		expect(await findUser(user.id)).toMatchObject({ loginCount: 5 });
	});

	test("update writes the requested value even when it equals what was read", async () => {
		const user = await createUser({ name: "A", email: "requested@example.com" });
		const racing = createInterleavingClient({
			shouldInterfere: isUpdateCommand,
			interfere: async () => {
				await adapter.update({
					model: "user",
					where: [{ field: "id", value: user.id }],
					update: { name: "B" },
				});
			},
		});

		const updated = await environment
			.createAdapter({ documentClient: racing.documentClient })
			.update<UserRow>({
				model: "user",
				where: [{ field: "email", value: "requested@example.com" }],
				update: { name: "A" },
			});

		expect(racing.interferences()).toBe(1);
		expect(updated?.name).toBe("A");
		expect(await findUser(user.id)).toMatchObject({ name: "A" });
	});

	test("update assigns lists and JSON as whole values", async () => {
		const user = await createUser({
			email: "whole@example.com",
			tags: ["x", "y"],
			prefs: { a: 1, b: 1 },
		});
		const where = [{ field: "id", value: user.id }];
		const racing = createInterleavingClient({
			shouldInterfere: isUpdateCommand,
			interfere: async () => {
				await adapter.update({
					model: "user",
					where,
					update: { tags: ["q", "y"], prefs: { a: 2, b: 1 } },
				});
			},
		});

		const updated = await environment
			.createAdapter({ documentClient: racing.documentClient })
			.update<UserRow & { tags: string[]; prefs: Record<string, number> }>({
				model: "user",
				where,
				update: { tags: ["x", "z"], prefs: { a: 1, b: 2 } },
			});

		expect(racing.interferences()).toBe(1);
		expect(updated).toMatchObject({ tags: ["x", "z"], prefs: { a: 1, b: 2 } });
		expect(await findUser(user.id)).toMatchObject({
			tags: ["x", "z"],
			prefs: { a: 1, b: 2 },
		});
	});

	test("update keeps a string and a number that look alike apart", async () => {
		const user = await createUser({
			email: "alike@example.com",
			loginCount: 0,
			nickname: "before",
		});

		const updated = await adapter.update<UserRow>({
			model: "user",
			where: [{ field: "id", value: user.id }],
			update: { nickname: "5", loginCount: 5 },
		});

		expect(updated).toMatchObject({ nickname: "5", loginCount: 5 });
		expect(await findUser(user.id)).toMatchObject({ nickname: "5", loginCount: 5 });
	});

	test("update to the stored values succeeds without changing the row", async () => {
		const user = await createUser({ email: "same@example.com", emailVerified: true });
		const where = [{ field: "email", value: "same@example.com" }];

		const count = await adapter.updateMany({
			model: "user",
			where,
			update: { emailVerified: true },
		});
		const row = await adapter.update<UserRow>({
			model: "user",
			where,
			update: { emailVerified: true },
		});

		expect(count).toBe(1);
		expect(row).toMatchObject({ id: user.id, emailVerified: true });
	});

	test("deleteMany counts the rows it deleted itself", async () => {
		const first = await createUser({ name: "to-delete", email: "delete-1@example.com" });
		await createUser({ name: "to-delete", email: "delete-2@example.com" });
		const racing = createInterleavingClient({
			shouldInterfere: isDeleteCommand,
			interfere: async () => {
				await documentClient.send(
					new DeleteCommand({
						TableName: environment.tableName("user"),
						Key: { id: first.id },
					}),
				);
			},
		});

		const deleted = await environment
			.createAdapter({ documentClient: racing.documentClient })
			.deleteMany({ model: "user", where: [{ field: "name", value: "to-delete" }] });

		expect(racing.interferences()).toBe(1);
		expect(deleted).toBe(1);
		expect(
			await adapter.count({ model: "user", where: [{ field: "name", value: "to-delete" }] }),
		).toBe(0);
	});
});

describe("transactions on DynamoDB Local", () => {
	const environment = createLocalEnvironment({
		tableNamePrefix: "write_transaction_",
		options,
	});
	const adapter = environment.createAdapter({ transaction: true });
	const { documentClient } = localClients;

	const createUser = (data: Record<string, unknown>): Promise<UserRow> =>
		adapter.create<Record<string, unknown>, UserRow>({
			model: "user",
			data: { name: "user", ...data },
			forceAllowId: true,
		});

	const names = (group: string) =>
		adapter.findMany<UserRow>({
			model: "user",
			where: [{ field: "email", operator: "ends_with", value: `@${group}.example.com` }],
			sortBy: { field: "name", direction: "asc" },
		});

	beforeAll(environment.setUp);
	afterAll(environment.tearDown);

	test("reads see the rows the transaction created, updated and deleted", async () => {
		const kept = await createUser({ name: "b-kept", email: "kept@reads.example.com" });
		const renamed = await createUser({ name: "c-old", email: "renamed@reads.example.com" });
		const removed = await createUser({ name: "d-removed", email: "removed@reads.example.com" });
		const where = [
			{ field: "email", operator: "ends_with" as const, value: "@reads.example.com" },
		];

		const seen = await adapter.transaction(async (tx) => {
			const created = await tx.create<Record<string, unknown>, UserRow>({
				model: "user",
				data: { name: "a-created", email: "created@reads.example.com" },
			});
			await tx.update({
				model: "user",
				where: [{ field: "id", value: renamed.id }],
				update: { name: "e-new" },
			});
			await tx.delete({ model: "user", where: [{ field: "id", value: removed.id }] });
			return {
				created,
				byId: await tx.findOne<UserRow>({
					model: "user",
					where: [{ field: "id", value: created.id }],
				}),
				byEmail: await tx.findOne<UserRow>({
					model: "user",
					where: [{ field: "email", value: "created@reads.example.com" }],
				}),
				deleted: await tx.findOne<UserRow>({
					model: "user",
					where: [{ field: "id", value: removed.id }],
				}),
				byOldName: await tx.findMany<UserRow>({
					model: "user",
					where: [{ field: "name", value: "c-old" }],
				}),
				byNewName: await tx.findMany<UserRow>({
					model: "user",
					where: [{ field: "name", value: "e-new" }],
				}),
				sorted: await tx.findMany<UserRow>({
					model: "user",
					where,
					sortBy: { field: "name", direction: "asc" },
				}),
				page: await tx.findMany<UserRow>({
					model: "user",
					where,
					sortBy: { field: "name", direction: "desc" },
					limit: 1,
					offset: 1,
				}),
				count: await tx.count({ model: "user", where }),
			};
		});

		expect(seen.byId).toEqual(seen.created);
		expect(seen.byEmail?.id).toBe(seen.created.id);
		expect(seen.deleted).toBeNull();
		expect(seen.byOldName).toHaveLength(0);
		expect(seen.byNewName.map((row) => row.id)).toEqual([renamed.id]);
		expect(seen.sorted.map((row) => row.name)).toEqual(["a-created", "b-kept", "e-new"]);
		expect(seen.page.map((row) => row.name)).toEqual(["b-kept"]);
		expect(seen.count).toBe(3);
		expect((await names("reads")).map((row) => row.name)).toEqual([
			"a-created",
			"b-kept",
			"e-new",
		]);
		expect(kept.name).toBe("b-kept");
	});

	test("joins include rows the transaction wrote", async () => {
		const user = await createUser({ email: "join@joins.example.com" });
		await adapter.create({
			model: "session",
			data: {
				userId: user.id,
				token: "stored-token",
				expiresAt: new Date("2100-01-01T00:00:00.000Z"),
			},
		});

		const joined = await adapter.transaction(async (tx) => {
			await tx.create({
				model: "session",
				data: {
					userId: user.id,
					token: "buffered-token",
					expiresAt: new Date("2100-01-01T00:00:00.000Z"),
				},
			});
			await tx.deleteMany({
				model: "session",
				where: [{ field: "token", value: "stored-token" }],
			});
			return tx.findOne<UserRow & { session: SessionRow[] }>({
				model: "user",
				where: [{ field: "id", value: user.id }],
				join: { session: true },
			});
		});

		expect(joined?.session.map((session) => session.token)).toEqual(["buffered-token"]);
	});

	test("commits several writes to one row as a single operation", async () => {
		const stored = await createUser({ name: "stored", email: "stored@fold.example.com" });

		await adapter.transaction(async (tx) => {
			const created = await tx.create<Record<string, unknown>, UserRow>({
				model: "user",
				data: { name: "created", email: "created@fold.example.com" },
			});
			await tx.update({
				model: "user",
				where: [{ field: "id", value: created.id }],
				update: { name: "created-updated" },
			});
			await tx.update({
				model: "user",
				where: [{ field: "id", value: stored.id }],
				update: { name: "stored-once" },
			});
			await tx.update({
				model: "user",
				where: [{ field: "id", value: stored.id }],
				update: { name: "stored-twice" },
			});
			const temporary = await tx.create<Record<string, unknown>, UserRow>({
				model: "user",
				data: { name: "temporary", email: "temporary@fold.example.com" },
			});
			await tx.delete({ model: "user", where: [{ field: "id", value: temporary.id }] });
		});

		expect((await names("fold")).map((row) => row.name)).toEqual([
			"created-updated",
			"stored-twice",
		]);
	});

	test("commits only the attributes it assigned", async () => {
		const user = await createUser({
			name: "before",
			email: "assigned@only.example.com",
			loginCount: 1,
		});

		await adapter.transaction(async (tx) => {
			await tx.update({
				model: "user",
				where: [{ field: "id", value: user.id }],
				update: { name: "after" },
			});
			// Another writer changes an attribute the transaction did not assign.
			await documentClient.send(
				new UpdateCommand({
					TableName: environment.tableName("user"),
					Key: { id: user.id },
					UpdateExpression: "SET #c = :c",
					ExpressionAttributeNames: { "#c": "loginCount" },
					ExpressionAttributeValues: { ":c": 7 },
				}),
			);
		});

		expect(
			await adapter.findOne<UserRow>({
				model: "user",
				where: [{ field: "id", value: user.id }],
			}),
		).toMatchObject({ name: "after", loginCount: 7 });
	});

	test("rejects a duplicate primary key inside and across transactions", async () => {
		await createUser({ id: "taken", email: "taken@duplicate.example.com" });

		const insideTransaction = await captureAsyncError(() =>
			adapter.transaction(async (tx) => {
				await tx.create({
					model: "user",
					data: { id: "twice", name: "one", email: "one@duplicate.example.com" },
					forceAllowId: true,
				});
				await tx.create({
					model: "user",
					data: { id: "twice", name: "two", email: "two@duplicate.example.com" },
					forceAllowId: true,
				});
			}),
		);
		const againstStoredRow = await captureAsyncError(() =>
			adapter.transaction(async (tx) => {
				await tx.create({
					model: "user",
					data: { id: "taken", name: "late", email: "late@duplicate.example.com" },
					forceAllowId: true,
				});
			}),
		);

		expect(insideTransaction).toMatchObject({ code: "DUPLICATE_PRIMARY_KEY" });
		expect(againstStoredRow).toMatchObject({ name: "TransactionCanceledException" });
		expect((await names("duplicate")).map((row) => row.email)).toEqual([
			"taken@duplicate.example.com",
		]);
	});

	test("writes nothing when the callback fails", async () => {
		const stored = await createUser({ name: "before", email: "stored@rollback.example.com" });

		const error = await captureAsyncError(() =>
			adapter.transaction(async (tx) => {
				await tx.create({
					model: "user",
					data: { name: "never", email: "never@rollback.example.com" },
				});
				await tx.update({
					model: "user",
					where: [{ field: "id", value: stored.id }],
					update: { name: "after" },
				});
				throw new Error("Simulated failure");
			}),
		);

		expect(error).toMatchObject({ message: "Simulated failure" });
		expect((await names("rollback")).map((row) => row.name)).toEqual(["before"]);
	});

	test("cancels an update of a row that was deleted before the commit", async () => {
		const user = await createUser({ email: "gone@late.example.com" });

		const error = await captureAsyncError(() =>
			adapter.transaction(async (tx) => {
				await tx.update({
					model: "user",
					where: [{ field: "id", value: user.id }],
					update: { name: "ghost" },
				});
				await documentClient.send(
					new DeleteCommand({
						TableName: environment.tableName("user"),
						Key: { id: user.id },
					}),
				);
			}),
		);

		expect(error).toMatchObject({ name: "TransactionCanceledException" });
		expect(await names("late")).toHaveLength(0);
	});
});
