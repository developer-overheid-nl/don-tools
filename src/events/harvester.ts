import type { Pool } from "pg";
import { HARVEST_LOCK, withAdvisoryLock } from "./database.js";
import { type Fetch, fetchUpcomingEvents } from "./pleio.js";
import type { EventStore, EventsLogger } from "./types.js";

const SOURCE = "pleio";
const LOG_FIELDS = { component: "events", operation: "pleio_harvest" };

export type SourceHarvestResult = {
  source: string;
  inserted: number;
  updated: number;
  unchanged: number;
  removed: number;
  skipped: number;
};

// Harvests each source independently: a failing source is logged and leaves its stored events untouched.
export const harvestPleio = async (
  repository: Pick<EventStore, "upsertHarvested" | "removeVanished">,
  sources: string[],
  logger: EventsLogger,
  { timeoutMs, fetchImpl }: { timeoutMs: number; fetchImpl?: Fetch },
): Promise<SourceHarvestResult[]> => {
  const results: SourceHarvestResult[] = [];
  for (const origin of sources) {
    const sourceName = new URL(origin).host;
    const startedAt = performance.now();
    try {
      const { events, unmappedIds, skipped } = await fetchUpcomingEvents(origin, { timeoutMs, fetchImpl });
      const result: SourceHarvestResult = {
        source: sourceName,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        removed: 0,
        skipped,
      };
      for (const event of events) result[await repository.upsertHarvested(SOURCE, sourceName, event)]++;
      // Unmapped entities with a guid still exist at the source, so their stored version is kept. Without a guid it is
      // unknown which stored event an entity is, so nothing is removed for that source in this run.
      if (unmappedIds.length === skipped) {
        const listed = [...events.map((event) => event.externalId), ...unmappedIds];
        result.removed = await repository.removeVanished(SOURCE, sourceName, listed);
      }
      results.push(result);
      const fields = { ...LOG_FIELDS, ...result, duration_ms: Math.round(performance.now() - startedAt) };
      if (skipped > 0) {
        logger.warn({ ...fields, unmapped_ids: unmappedIds }, "pleio harvest completed with skipped events");
      } else {
        logger.info(fields, "pleio harvest completed");
      }
    } catch (error) {
      logger.error(
        {
          ...LOG_FIELDS,
          source: sourceName,
          duration_ms: Math.round(performance.now() - startedAt),
          error_message: error instanceof Error ? error.message : String(error),
        },
        "pleio harvest failed",
      );
    }
  }
  return results;
};

export type PleioHarvestOptions = {
  sources: string[];
  timeoutMs: number;
  logger: EventsLogger;
  fetchImpl?: Fetch;
};

// Harvests all sources under the advisory lock, so only one replica harvests; undefined when another one holds it.
export const runPleioHarvest = (
  pool: Pool,
  repository: Pick<EventStore, "upsertHarvested" | "removeVanished">,
  { sources, timeoutMs, logger, fetchImpl }: PleioHarvestOptions,
): Promise<SourceHarvestResult[] | undefined> =>
  withAdvisoryLock(pool, HARVEST_LOCK, () => harvestPleio(repository, sources, logger, { timeoutMs, fetchImpl }));
