/**
 * @file Where clause semantics against DynamoDB Local: clauses that touch key
 * attributes outside the key condition, comparisons with null, and null
 * values of index key attributes.
 */
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { BetterAuthOptions } from "@better-auth/core";
import { createLocalEnvironment, localClients } from "./dynamodb-local-environment";

type VerificationRow = { id: string; identifier: string; value: string };

type DeviceRow = {
	id: string;
	label: string;
	ownerId?: string | null;
	note?: string | null;
	uses?: number | null;
};

const options: BetterAuthOptions = {
	plugins: [
		{
			id: "device-test",
			schema: {
				device: {
					fields: {
						label: { type: "string", required: true },
						// A reference gets a global secondary index.
						ownerId: {
							type: "string",
							required: false,
							references: { model: "user", field: "id" },
						},
						note: { type: "string", required: false },
						uses: { type: "number", required: false },
					},
				},
			},
		},
	],
};

describe("where clause semantics on DynamoDB Local", () => {
	const environment = createLocalEnvironment({
		tableNamePrefix: "where_semantics_",
		options,
	});
	const adapter = environment.createAdapter();
	const { documentClient } = localClients;

	const createVerification = (
		identifier: string,
		createdAt: Date,
	): Promise<VerificationRow> =>
		adapter.create<Record<string, unknown>, VerificationRow>({
			model: "verification",
			data: {
				identifier,
				value: "v",
				createdAt,
				expiresAt: new Date("2100-01-01T00:00:00.000Z"),
			},
		});

	const createDevice = (data: Record<string, unknown>): Promise<DeviceRow> =>
		adapter.create<Record<string, unknown>, DeviceRow>({ model: "device", data });

	const createUser = (email: string): Promise<{ id: string }> =>
		adapter.create<Record<string, unknown>, { id: string }>({
			model: "user",
			data: { name: "owner", email },
		});

	const readStoredDevice = async (id: string) => {
		const output = await documentClient.send(
			new GetCommand({ TableName: environment.tableName("device"), Key: { id } }),
		);
		return output.Item;
	};

	beforeAll(environment.setUp);
	afterAll(environment.tearDown);

	describe("key attributes outside the key condition", () => {
		test("accepts a repeated primary key condition", async () => {
			const row = await createVerification("repeat-pk", new Date());
			const where = [
				{ field: "id", value: row.id },
				{ field: "id", value: row.id },
			];

			expect(await adapter.findMany({ model: "verification", where })).toHaveLength(1);
			expect(await adapter.count({ model: "verification", where })).toBe(1);
			expect(
				await adapter.findMany({
					model: "verification",
					where: [
						{ field: "id", value: row.id },
						{ field: "id", value: "another-id" },
					],
				}),
			).toHaveLength(0);
			expect(await adapter.deleteMany({ model: "verification", where })).toBe(1);
		});

		test("accepts a repeated index partition key condition", async () => {
			await createVerification("repeat-gsi", new Date());

			const rows = await adapter.findMany({
				model: "verification",
				where: [
					{ field: "identifier", value: "repeat-gsi" },
					{ field: "identifier", value: "repeat-gsi" },
				],
			});

			expect(rows).toHaveLength(1);
		});

		test("applies a range on the index sort key", async () => {
			const old = await createVerification(
				"sort-range",
				new Date("2020-01-01T00:00:00.000Z"),
			);
			const recent = await createVerification(
				"sort-range",
				new Date("2024-01-01T00:00:00.000Z"),
			);
			const where = [
				{ field: "identifier", value: "sort-range" },
				{
					field: "createdAt",
					operator: "gt" as const,
					value: new Date("2022-01-01T00:00:00.000Z"),
				},
			];

			const rows = await adapter.findMany<VerificationRow>({
				model: "verification",
				where,
			});
			const limited = await adapter.findMany<VerificationRow>({
				model: "verification",
				where,
				limit: 1,
			});

			expect(rows.map((row) => row.id)).toEqual([recent.id]);
			expect(limited.map((row) => row.id)).toEqual([recent.id]);
			expect(await adapter.count({ model: "verification", where })).toBe(1);
			expect(rows.map((row) => row.id)).not.toContain(old.id);
		});

		test("filters an index query by the table's primary key", async () => {
			const first = await createVerification("gsi-and-id", new Date());
			const second = await createVerification("gsi-and-id", new Date());

			const rows = await adapter.findMany<VerificationRow>({
				model: "verification",
				where: [
					{ field: "identifier", value: "gsi-and-id" },
					{ field: "id", operator: "ne", value: first.id },
				],
			});

			expect(rows.map((row) => row.id)).toEqual([second.id]);
		});

		test("evaluates an OR group that names the key attribute", async () => {
			const first = await createVerification("or-on-key", new Date());
			await createVerification("or-on-key", new Date());
			const other = await createVerification("or-on-key-other", new Date());

			const rows = await adapter.findMany<VerificationRow>({
				model: "verification",
				where: [
					{ field: "identifier", value: "or-on-key" },
					{ field: "id", value: first.id, connector: "OR" },
					{ field: "id", value: other.id, connector: "OR" },
				],
			});

			expect(rows.map((row) => row.id)).toEqual([first.id]);
		});
	});

	describe("comparisons with null", () => {
		test("eq null matches a NULL attribute and a missing one, ne null neither", async () => {
			const stored = await createDevice({ label: "null-eq", note: null });
			const missing = await createDevice({ label: "null-eq" });
			const filled = await createDevice({ label: "null-eq", note: "text" });
			const label = { field: "label", value: "null-eq" };

			const isNull = await adapter.findMany<DeviceRow>({
				model: "device",
				where: [label, { field: "note", value: null }],
			});
			const isNotNull = await adapter.findMany<DeviceRow>({
				model: "device",
				where: [label, { field: "note", operator: "ne", value: null }],
			});

			expect(isNull.map((row) => row.id).sort()).toEqual(
				[stored.id, missing.id].sort(),
			);
			expect(isNotNull.map((row) => row.id)).toEqual([filled.id]);
			expect(
				await adapter.count({
					model: "device",
					where: [label, { field: "note", value: null }],
				}),
			).toBe(2);
		});

		test("guards an atomic update on a null field", async () => {
			const device = await createDevice({ label: "null-guard" });
			const claim = (note: string) =>
				adapter.incrementOne<DeviceRow>({
					model: "device",
					where: [
						{ field: "id", value: device.id },
						{ field: "note", value: null },
					],
					increment: { uses: 1 },
					set: { note },
				});

			const first = await claim("claimed");
			const second = await claim("claimed again");

			expect(first).toMatchObject({ note: "claimed", uses: 1 });
			expect(second).toBeNull();
		});
	});

	describe("null values of an index key attribute", () => {
		test("stores a null foreign key as a missing attribute and reads it back as null", async () => {
			const created = await createDevice({ label: "fk-null", ownerId: null });

			const stored = await readStoredDevice(created.id);
			const found = await adapter.findOne<DeviceRow>({
				model: "device",
				where: [{ field: "id", value: created.id }],
			});
			const listed = await adapter.findMany<DeviceRow>({
				model: "device",
				where: [
					{ field: "label", value: "fk-null" },
					{ field: "ownerId", value: null },
				],
			});

			expect(created.ownerId).toBeNull();
			expect(stored).not.toHaveProperty("ownerId");
			expect(found?.ownerId).toBeNull();
			expect(listed.map((row) => row.id)).toEqual([created.id]);
			expect(listed[0]?.ownerId).toBeNull();
		});

		test("moves a row in and out of the index as the key is set and cleared", async () => {
			const owner = await createUser("fk-owner@example.com");
			const device = await createDevice({ label: "fk-move", ownerId: null });
			const byOwner = () =>
				adapter.findMany<DeviceRow>({
					model: "device",
					where: [{ field: "ownerId", value: owner.id }],
				});
			const where = [{ field: "id", value: device.id }];

			const assigned = await adapter.update<DeviceRow>({
				model: "device",
				where,
				update: { ownerId: owner.id },
			});
			const indexed = await byOwner();
			const cleared = await adapter.update<DeviceRow>({
				model: "device",
				where,
				update: { ownerId: null },
			});
			const afterClear = await byOwner();

			expect(assigned?.ownerId).toBe(owner.id);
			expect(indexed.map((row) => row.id)).toEqual([device.id]);
			expect(cleared?.ownerId).toBeNull();
			expect(await readStoredDevice(device.id)).not.toHaveProperty("ownerId");
			expect(afterClear).toHaveLength(0);
		});

		test("clears an index key through incrementOne", async () => {
			const owner = await createUser("fk-release@example.com");
			const device = await createDevice({ label: "fk-release", ownerId: owner.id });

			const released = await adapter.incrementOne<DeviceRow>({
				model: "device",
				where: [
					{ field: "id", value: device.id },
					{ field: "ownerId", value: owner.id },
				],
				increment: {},
				set: { ownerId: null },
			});

			expect(released?.ownerId).toBeNull();
			expect(await readStoredDevice(device.id)).not.toHaveProperty("ownerId");
		});

		test("matches a NULL written by another client with eq null", async () => {
			const device = await createDevice({ label: "foreign-null", note: "x" });
			await documentClient.send(
				new UpdateCommand({
					TableName: environment.tableName("device"),
					Key: { id: device.id },
					UpdateExpression: "SET #n = :null",
					ExpressionAttributeNames: { "#n": "note" },
					ExpressionAttributeValues: { ":null": null },
				}),
			);

			const found = await adapter.findOne<DeviceRow>({
				model: "device",
				where: [
					{ field: "id", value: device.id },
					{ field: "note", value: null },
				],
			});

			expect(found?.id).toBe(device.id);
			expect(found?.note).toBeNull();
		});
	});
});
