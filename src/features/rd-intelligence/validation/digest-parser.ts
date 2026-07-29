import { ValidationError } from "./source-item-parser.js";

export interface AsiaTokyoDayRange {
  readonly localDate: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly previousDayStartAt: string;
}

function datePartsInTokyo(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(
    parts.map((part) => [part.type, part.value] as const),
  );
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (year === undefined || month === undefined || day === undefined) {
    throw new TypeError("Could not resolve Asia/Tokyo local date");
  }
  return `${year}-${month}-${day}`;
}

function assertCalendarDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new ValidationError(
      "localDate",
      "must use YYYY-MM-DD",
    );
  }
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new ValidationError("localDate", "must be a calendar date");
  }
}

export function asiaTokyoLocalDate(
  value: unknown,
  now: Date,
): string {
  if (value === undefined || value === null) {
    return datePartsInTokyo(now);
  }
  if (typeof value !== "string") {
    throw new ValidationError("localDate", "must be a string");
  }
  assertCalendarDate(value);
  return value;
}

export function asiaTokyoDayRange(
  localDate: string,
): AsiaTokyoDayRange {
  assertCalendarDate(localDate);
  const start = new Date(`${localDate}T00:00:00+09:00`);
  const startTime = start.getTime();
  if (Number.isNaN(startTime)) {
    throw new ValidationError("localDate", "is not valid");
  }
  return {
    localDate,
    startAt: new Date(startTime).toISOString(),
    endAt: new Date(startTime + 86_400_000).toISOString(),
    previousDayStartAt: new Date(
      startTime - 86_400_000,
    ).toISOString(),
  };
}
