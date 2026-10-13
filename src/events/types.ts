// Public types of the events agenda. The HTTP API maps these to its OpenAPI schemas (AgendaEvent*).

export type EventSource = "manual" | "pleio";

// Input of a manual event, as received from the API (date-times are RFC 3339 strings).
export interface EventInput {
  title: string;
  summary?: string;
  startsAt: string;
  endsAt: string;
  location?: string;
  url: string;
}

// An event as returned by the API: date-times carry the offset of the configured time zone.
export interface AgendaEvent {
  id: string;
  title: string;
  summary?: string;
  startsAt: string;
  endsAt: string;
  location?: string;
  url: string;
  source: EventSource;
  sourceName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventRecord {
  id: string;
  source: EventSource;
  sourceName: string | null;
  title: string;
  summary: string | null;
  location: string | null;
  url: string;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventFields {
  title: string;
  summary?: string;
  location?: string;
  url: string;
  startsAt: Date;
  endsAt: Date;
}

export interface HarvestedEvent extends EventFields {
  externalId: string;
  sourceUpdatedAt?: Date;
}

export interface EventFilter {
  endsAfter?: Date;
  startsBefore?: Date;
  source?: EventSource;
  limit: number;
  offset: number;
}

export type MutationResult = { status: "ok"; event: EventRecord } | { status: "not_found" } | { status: "harvested" };

export type UpsertResult = "inserted" | "updated" | "unchanged";

// Storage port of the agenda; EventsRepository is the PostgreSQL adapter.
export interface EventStore {
  list(filter: EventFilter): Promise<{ events: EventRecord[]; total: number }>;
  get(id: string): Promise<EventRecord | undefined>;
  create(fields: EventFields): Promise<EventRecord>;
  update(id: string, fields: EventFields): Promise<MutationResult>;
  remove(id: string): Promise<boolean>;
  upsertHarvested(source: EventSource, sourceName: string, event: HarvestedEvent): Promise<UpsertResult>;
  removeVanished(source: EventSource, sourceName: string, seenExternalIds: string[]): Promise<number>;
}

// Structured logger, compatible with pino.
export interface EventsLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}
