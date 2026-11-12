// A teacher's assignment has a start date and an optional end date.
// The end date is their last day, included. The next day they no longer
// see that section. Dates are compared as calendar days in UTC because the
// stored value is a date, not a clock time, and phone timezones vary.
export function isCurrentAssignment(startsOn: Date, endsOn: Date | null, now: Date): boolean {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = Date.UTC(startsOn.getUTCFullYear(), startsOn.getUTCMonth(), startsOn.getUTCDate());
  if (start > today) return false;
  if (!endsOn) return true;
  const end = Date.UTC(endsOn.getUTCFullYear(), endsOn.getUTCMonth(), endsOn.getUTCDate());
  return end >= today;
}

/// Calendar day in UTC. Assignment dates are stored as dates, not clock times.
export function utcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/// The day before `day`. An assignment's end date is the last day included, so
/// ending it yesterday means the teacher loses the section the moment the
/// handoff is confirmed, including later the same calendar day.
export function dayBefore(day: Date): Date {
  return new Date(day.getTime() - 86_400_000);
}

/// Last UTC day included when an admin ends an assignment.
/// An older assignment ends yesterday, so access stops during that same UTC day.
/// An assignment that started today cannot end yesterday. It ends today, and
/// the teacher keeps the section until that UTC day is over.
export function reassignmentEndDate(startsOn: Date, now: Date): Date {
  const start = utcDay(startsOn);
  const previous = dayBefore(utcDay(now));
  if (previous.getTime() < start.getTime()) return start;
  return previous;
}
