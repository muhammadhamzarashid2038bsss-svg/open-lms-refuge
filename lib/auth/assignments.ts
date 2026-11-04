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
