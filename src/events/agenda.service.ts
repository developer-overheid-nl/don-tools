import { HttpError } from "../utils/problem-details.js";
import { isDatabaseUnavailable } from "./database.js";
import { formatDateTime, isHttpUrl, parseDateTime } from "./datetime.js";
import type { AgendaEvent, EventFields, EventInput, EventRecord, EventSource, EventStore } from "./types.js";

export type ListEventsQuery = {
  page: number;
  perPage: number;
  endsAfter?: string;
  startsBefore?: string;
  source?: EventSource;
};

export type EventPage = {
  events: AgendaEvent[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

const notFound = (id: string) => new HttpError(404, `Event ${id} does not exist`);

// Rules of the events agenda on top of an EventStore; failures are HttpErrors, like the other tools.
export class EventAgenda {
  constructor(
    private readonly store: EventStore,
    private readonly timeZone: string,
  ) {}

  async list(query: ListEventsQuery): Promise<EventPage> {
    const { events, total } = await this.call((store) =>
      store.list({
        endsAfter: query.endsAfter ? parseDateTime(query.endsAfter) : undefined,
        startsBefore: query.startsBefore ? parseDateTime(query.startsBefore) : undefined,
        source: query.source,
        limit: query.perPage,
        offset: (query.page - 1) * query.perPage,
      }),
    );
    return {
      events: events.map((event) => this.toAgendaEvent(event)),
      total,
      page: query.page,
      perPage: query.perPage,
      totalPages: Math.max(1, Math.ceil(total / query.perPage)),
    };
  }

  async get(id: string): Promise<AgendaEvent> {
    const event = await this.call((store) => store.get(id));
    if (!event) throw notFound(id);
    return this.toAgendaEvent(event);
  }

  async create(input: EventInput): Promise<AgendaEvent> {
    const fields = toFields(input);
    return this.toAgendaEvent(await this.call((store) => store.create(fields)));
  }

  async update(id: string, input: EventInput): Promise<AgendaEvent> {
    const fields = toFields(input);
    const result = await this.call((store) => store.update(id, fields));
    if (result.status === "not_found") throw notFound(id);
    if (result.status === "harvested") {
      throw new HttpError(409, `Event ${id} is harvested and can only be changed at its source`);
    }
    return this.toAgendaEvent(result.event);
  }

  // Manual events are removed; harvested events are hidden, so the next harvest does not bring them back.
  async remove(id: string): Promise<void> {
    if (!(await this.call((store) => store.remove(id)))) throw notFound(id);
  }

  toAgendaEvent(record: EventRecord): AgendaEvent {
    return {
      id: record.id,
      title: record.title,
      ...(record.summary ? { summary: record.summary } : {}),
      startsAt: formatDateTime(record.startsAt, this.timeZone),
      endsAt: formatDateTime(record.endsAt, this.timeZone),
      ...(record.location ? { location: record.location } : {}),
      url: record.url,
      source: record.source,
      ...(record.sourceName ? { sourceName: record.sourceName } : {}),
      createdAt: formatDateTime(record.createdAt, this.timeZone),
      updatedAt: formatDateTime(record.updatedAt, this.timeZone),
    };
  }

  // Only database outages become 503; any other error is a bug and stays a 500.
  private async call<T>(work: (store: EventStore) => Promise<T>): Promise<T> {
    try {
      return await work(this.store);
    } catch (error) {
      if (!isDatabaseUnavailable(error)) throw error;
      throw new HttpError(503, "Events database is unavailable", { cause: error });
    }
  }
}

// Format, length and required fields are validated against the OAS before this runs.
export const toFields = (input: EventInput): EventFields => {
  const title = input.title.trim();
  if (!title) throw new HttpError(400, "title must not be blank");
  if (!isHttpUrl(input.url)) throw new HttpError(400, "url must be an http or https url");
  const startsAt = parseDateTime(input.startsAt);
  const endsAt = parseDateTime(input.endsAt);
  if (!startsAt || !endsAt) throw new HttpError(400, "startsAt and endsAt must be RFC 3339 date-times");
  if (endsAt < startsAt) throw new HttpError(400, "endsAt must not be before startsAt");
  return {
    title,
    summary: input.summary?.trim(),
    location: input.location?.trim(),
    url: input.url,
    startsAt,
    endsAt,
  };
};
