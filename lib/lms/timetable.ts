// Weekly timetable rules for LMS-2 Phase 1.
// A class is stored as one ClassSession (a real start and end). The screen
// speaks in weekday and clock time because that is how teachers plan a week.
// Times are the center's clock, not the phone clock. Phone clocks in a
// classroom are often wrong, and the class happens at the center.
//
// Live links are allow-listed. A cheap phone should not open an unexpected site
// from a Join button. There is no video hosting and no offline media save here.

export const WEEKDAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

export type WeekdayName = (typeof WEEKDAYS)[number];

export const DELIVERY_MODES = ["IN_PERSON", "LIVE_ONLINE", "PRE_RECORDED"] as const;

export type DeliveryModeName = (typeof DELIVERY_MODES)[number];

const WEEKDAY_FROM_MONDAY: Record<WeekdayName, number> = {
  MONDAY: 0,
  TUESDAY: 1,
  WEDNESDAY: 2,
  THURSDAY: 3,
  FRIDAY: 4,
  SATURDAY: 5,
  SUNDAY: 6,
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type CivilDate = { year: number; month: number; day: number };

export type CivilDateTime = CivilDate & { hour: number; minute: number };

export type TimetableInput = {
  title: string;
  weekday: string;
  startTime: string;
  endTime: string;
  weekOf: string;
  deliveryMode: string;
  meetingUrl?: string | null;
  linkedResourceId?: string | null;
};

export type NormalizedTimetableInput = {
  title: string;
  weekday: WeekdayName;
  startMinute: number;
  endMinute: number;
  startTime: string;
  endTime: string;
  weekOf: string;
  monday: CivilDate;
  deliveryMode: DeliveryModeName;
  meetingUrl: string | null;
  linkedResourceId: string | null;
};

export function weekdayLabel(weekday: string): string {
  switch (weekday) {
    case "MONDAY":
      return "Monday";
    case "TUESDAY":
      return "Tuesday";
    case "WEDNESDAY":
      return "Wednesday";
    case "THURSDAY":
      return "Thursday";
    case "FRIDAY":
      return "Friday";
    case "SATURDAY":
      return "Saturday";
    case "SUNDAY":
      return "Sunday";
    default:
      return "Day";
  }
}

export function deliveryLabel(mode: string): string {
  switch (mode) {
    case "IN_PERSON":
      return "In person";
    case "LIVE_ONLINE":
      return "Live online";
    case "PRE_RECORDED":
      return "Pre-recorded";
    default:
      return "Class";
  }
}

export function materialLabel(resourceType: string): string {
  switch (resourceType) {
    case "AUDIO":
      return "Open audio";
    case "PDF":
      return "Open file";
    case "TEXT":
      return "Read lesson";
    default:
      return "Open lesson";
  }
}

export function clockLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatCivilDate(date: CivilDate): string {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function formatShortDate(date: CivilDate): string {
  const month = MONTHS[date.month - 1] ?? "";
  return `${date.day} ${month} ${date.year}`;
}

export function parseIsoDate(value: string): CivilDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function addCalendarDays(date: CivilDate, days: number): CivilDate {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

export function mondayOnOrBefore(date: CivilDate): CivilDate {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day));
  const weekday = utc.getUTCDay();
  const delta = weekday === 0 ? -6 : 1 - weekday;
  return addCalendarDays(date, delta);
}

export function isWeekdayName(value: string): value is WeekdayName {
  return (WEEKDAYS as readonly string[]).includes(value);
}

export function isDeliveryModeName(value: string): value is DeliveryModeName {
  return (DELIVERY_MODES as readonly string[]).includes(value);
}

function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23) return null;
  return hour * 60 + minute;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(date: Date, timeZone: string): CivilDateTime | null {
  if (!isValidTimeZone(timeZone)) return null;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  let year = Number(map.year);
  let month = Number(map.month);
  let day = Number(map.day);
  let hour = Number(map.hour);
  const minute = Number(map.minute);
  if ([year, month, day, hour, minute].some((part) => Number.isNaN(part))) return null;
  // Some engines report midnight as 24:00 on the previous civil date.
  if (hour === 24) {
    hour = 0;
    const next = addCalendarDays({ year, month, day }, 1);
    year = next.year;
    month = next.month;
    day = next.day;
  }
  return { year, month, day, hour, minute };
}

export function zonedDateTimeToUtc(civil: CivilDateTime, timeZone: string): Date | null {
  if (!isValidTimeZone(timeZone)) return null;
  const utcGuess = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour, civil.minute, 0, 0);
  let instant = utcGuess;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(instant), timeZone);
    if (!parts) return null;
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    const next = utcGuess - (asUtc - instant);
    if (next === instant) break;
    instant = next;
  }
  const check = zonedParts(new Date(instant), timeZone);
  if (!check) return null;
  if (
    check.year !== civil.year ||
    check.month !== civil.month ||
    check.day !== civil.day ||
    check.hour !== civil.hour ||
    check.minute !== civil.minute
  ) {
    return null;
  }
  return new Date(instant);
}

export function weekdayOfInstant(date: Date, timeZone: string): WeekdayName | null {
  if (!isValidTimeZone(timeZone)) return null;
  const short = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  switch (short) {
    case "Mon":
      return "MONDAY";
    case "Tue":
      return "TUESDAY";
    case "Wed":
      return "WEDNESDAY";
    case "Thu":
      return "THURSDAY";
    case "Fri":
      return "FRIDAY";
    case "Sat":
      return "SATURDAY";
    case "Sun":
      return "SUNDAY";
    default:
      return null;
  }
}

export function clockOfInstant(date: Date, timeZone: string): string | null {
  const parts = zonedParts(date, timeZone);
  if (!parts) return null;
  return clockLabel(parts.hour * 60 + parts.minute);
}

export function localDateOfInstant(date: Date, timeZone: string): CivilDate | null {
  const parts = zonedParts(date, timeZone);
  if (!parts) return null;
  return { year: parts.year, month: parts.month, day: parts.day };
}

function allowedMeetingHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "meet.google.com") return true;
  if (host === "meet.jit.si") return true;
  if (host === "8x8.vc" || host.endsWith(".8x8.vc")) return true;
  if (host === "zoom.us" || host.endsWith(".zoom.us")) return true;
  return false;
}

export function validateMeetingUrl(raw: string): { ok: true; url: string } | { ok: false; message: string } {
  const message = "Live classes need an https link from Google Meet, Zoom, or Jitsi.";
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2000 || /[\s\\]/.test(trimmed)) return { ok: false, message };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, message };
  }
  if (url.protocol !== "https:") return { ok: false, message };
  if (url.username || url.password) return { ok: false, message };
  if (url.port) return { ok: false, message };
  if (!allowedMeetingHost(url.hostname)) return { ok: false, message };
  if (!url.pathname || url.pathname === "/") return { ok: false, message };
  url.hash = "";
  return { ok: true, url: url.href };
}

export function validateTimetableInput(
  input: TimetableInput,
): { ok: true; value: NormalizedTimetableInput } | { ok: false; message: string } {
  const title = input.title.trim();
  if (title.length < 2) return { ok: false, message: "Class name needs at least 2 characters." };
  if (title.length > 80) return { ok: false, message: "Class name is too long." };

  if (!isWeekdayName(input.weekday)) return { ok: false, message: "Choose a day of the week." };
  if (!isDeliveryModeName(input.deliveryMode)) {
    return { ok: false, message: "Choose in person, live online, or pre-recorded." };
  }

  const startMinute = parseClock(input.startTime);
  const endMinute = parseClock(input.endTime);
  if (startMinute === null || endMinute === null) {
    return { ok: false, message: "Use a start and end time like 09:00." };
  }
  if (endMinute <= startMinute) return { ok: false, message: "End time must be after the start time." };

  const weekDate = parseIsoDate(input.weekOf);
  if (!weekDate) return { ok: false, message: "Choose which week this class is in." };
  const monday = mondayOnOrBefore(weekDate);

  const meetingRaw = (input.meetingUrl ?? "").trim();
  const resourceRaw = (input.linkedResourceId ?? "").trim();
  let meetingUrl: string | null = null;
  if (input.deliveryMode === "LIVE_ONLINE") {
    if (!meetingRaw) return { ok: false, message: "Live classes need an https link from Google Meet, Zoom, or Jitsi." };
    const checked = validateMeetingUrl(meetingRaw);
    if (!checked.ok) return checked;
    meetingUrl = checked.url;
  } else if (meetingRaw) {
    return { ok: false, message: "A meeting link is only for a live online class." };
  }

  if (input.deliveryMode === "PRE_RECORDED" && !resourceRaw) {
    return { ok: false, message: "Pre-recorded classes need a lesson or audio from this course." };
  }

  return {
    ok: true,
    value: {
      title,
      weekday: input.weekday,
      startMinute,
      endMinute,
      startTime: clockLabel(startMinute),
      endTime: clockLabel(endMinute),
      weekOf: formatCivilDate(monday),
      monday,
      deliveryMode: input.deliveryMode,
      meetingUrl,
      linkedResourceId: resourceRaw || null,
    },
  };
}

export function sessionInstants(
  value: NormalizedTimetableInput,
  timeZone: string,
): { startsAt: Date; endsAt: Date } | null {
  const day = addCalendarDays(value.monday, WEEKDAY_FROM_MONDAY[value.weekday]);
  const startsAt = zonedDateTimeToUtc(
    { ...day, hour: Math.floor(value.startMinute / 60), minute: value.startMinute % 60 },
    timeZone,
  );
  const endsAt = zonedDateTimeToUtc(
    { ...day, hour: Math.floor(value.endMinute / 60), minute: value.endMinute % 60 },
    timeZone,
  );
  if (!startsAt || !endsAt || endsAt.getTime() <= startsAt.getTime()) return null;
  return { startsAt, endsAt };
}

export function weekBounds(
  monday: CivilDate,
  timeZone: string,
): { start: Date; end: Date } | null {
  const start = zonedDateTimeToUtc({ ...monday, hour: 0, minute: 0 }, timeZone);
  const end = zonedDateTimeToUtc({ ...addCalendarDays(monday, 7), hour: 0, minute: 0 }, timeZone);
  if (!start || !end || end.getTime() <= start.getTime()) return null;
  return { start, end };
}

export function dayBounds(date: CivilDate, timeZone: string): { start: Date; end: Date } | null {
  const start = zonedDateTimeToUtc({ ...date, hour: 0, minute: 0 }, timeZone);
  const end = zonedDateTimeToUtc({ ...addCalendarDays(date, 1), hour: 0, minute: 0 }, timeZone);
  if (!start || !end) return null;
  return { start, end };
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
