import { describe, expect, it } from "vitest";
import { EventAgenda } from "../src/events/agenda.service.js";
import { isDatabaseUnavailable } from "../src/events/database.js";
import type { EventRecord, EventStore } from "../src/events/types.js";
import type { HttpError } from "../src/utils/problem-details.js";

const record = (overrides: Partial<EventRecord> = {}): EventRecord => ({
  id: "0f8d3c1e-7a3b-4f5e-9b1a-2c6d4e8f0a12",
  source: "manual",
  sourceName: null,
  title: "PGDay Lowlands 2026",
  summary: null,
  location: "Utrecht",
  url: "https://2026.pgday.nl/",
  startsAt: new Date("2026-09-10T07:00:00Z"),
  endsAt: new Date("2026-09-10T15:00:00Z"),
  createdAt: new Date("2026-09-01T10:00:00Z"),
  updatedAt: new Date("2026-09-01T10:00:00Z"),
  ...overrides,
});

const input = {
  title: "PGDay Lowlands 2026",
  startsAt: "2026-09-10T09:00:00+02:00",
  endsAt: "2026-09-10T17:00:00+02:00",
  url: "https://2026.pgday.nl/",
};

const unused = async () => {
  throw new Error("not used in this test");
};

const store = (overrides: Partial<EventStore> = {}): EventStore => ({
  list: unused,
  get: unused,
  create: unused,
  update: unused,
  remove: unused,
  upsertHarvested: unused,
  removeVanished: unused,
  ...overrides,
});

const status = (value: number) => ({ name: "HttpError", status: value }) satisfies Partial<HttpError>;

describe("EventAgenda", () => {
  it("formats records with the Dutch offset and without empty fields", async () => {
    const agenda = new EventAgenda(store({ get: async () => record() }));
    expect(await agenda.get("id")).toEqual({
      id: "0f8d3c1e-7a3b-4f5e-9b1a-2c6d4e8f0a12",
      title: "PGDay Lowlands 2026",
      startsAt: "2026-09-10T09:00:00+02:00",
      endsAt: "2026-09-10T17:00:00+02:00",
      location: "Utrecht",
      url: "https://2026.pgday.nl/",
      source: "manual",
      createdAt: "2026-09-01T12:00:00+02:00",
      updatedAt: "2026-09-01T12:00:00+02:00",
    });
  });

  it("pages the list", async () => {
    let offset: number | undefined;
    const agenda = new EventAgenda(
      store({
        list: async (filter) => {
          offset = filter.offset;
          return { events: [record()], total: 41 };
        },
      }),
    );
    expect(await agenda.list({ page: 3, perPage: 20 })).toMatchObject({ total: 41, page: 3, totalPages: 3 });
    expect(offset).toBe(40);
  });

  it("maps missing and harvested events to 404 and 409", async () => {
    const agenda = new EventAgenda(
      store({
        get: async () => undefined,
        update: async (id) => (id === "gone" ? { status: "not_found" } : { status: "harvested" }),
        remove: async () => false,
      }),
    );
    await expect(agenda.get("gone")).rejects.toMatchObject(status(404));
    await expect(agenda.update("gone", input)).rejects.toMatchObject(status(404));
    await expect(agenda.update("pleio", input)).rejects.toMatchObject(status(409));
    await expect(agenda.remove("gone")).rejects.toMatchObject(status(404));
  });

  it("rejects invalid input before touching the store", async () => {
    const agenda = new EventAgenda(store());
    await expect(agenda.create({ ...input, title: "   " })).rejects.toMatchObject(status(400));
    await expect(agenda.create({ ...input, url: "javascript:alert(1)" })).rejects.toMatchObject(status(400));
    await expect(agenda.create({ ...input, endsAt: "2026-09-10T08:00:00+02:00" })).rejects.toMatchObject(status(400));
  });

  it("turns database outages into 503 and leaves other errors alone", async () => {
    const outage = Object.assign(new Error("relation does not exist"), { code: "42P01" });
    const bug = new TypeError("x is undefined");
    const failing = (error: Error) =>
      new EventAgenda(
        store({
          get: async () => {
            throw error;
          },
        }),
      );
    await expect(failing(outage).get("id")).rejects.toMatchObject(status(503));
    await expect(failing(bug).get("id")).rejects.toBe(bug);
  });
});

describe("isDatabaseUnavailable", () => {
  it("recognises outages but not bugs", () => {
    expect(isDatabaseUnavailable(Object.assign(new Error("relation does not exist"), { code: "42P01" }))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error("terminating connection"), { code: "57P01" }))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error("connect"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isDatabaseUnavailable(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error("syntax error"), { code: "42601" }))).toBe(false);
    expect(isDatabaseUnavailable(new TypeError("x is undefined"))).toBe(false);
  });
});
