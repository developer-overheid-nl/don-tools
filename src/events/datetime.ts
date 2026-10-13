// The agenda is Dutch, so moments are shown in Dutch local time.
const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Amsterdam",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

// Formats an instant as an RFC 3339 date-time with the Dutch UTC offset (+01:00 or +02:00); ADR requires an offset.
export const formatDateTime = (instant: Date): string => {
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  const wholeSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  const offsetMinutes = Math.round((Date.parse(`${local}Z`) - wholeSeconds) / 60_000);
  const hours = String(Math.floor(offsetMinutes / 60)).padStart(2, "0");
  const minutes = String(offsetMinutes % 60).padStart(2, "0");
  return `${local}+${hours}:${minutes}`;
};

// Pleio and clients send ISO 8601 with an offset; an unparsable value becomes undefined instead of an Invalid Date.
export const parseDateTime = (value: string): Date | undefined => {
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? undefined : instant;
};
