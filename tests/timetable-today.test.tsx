import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TimetableWeek } from "../components/timetable-week";
import type { WeeklyTimetable } from "../lib/data/timetable";
import { WEEKDAYS, todayInDisplayedWeek } from "../lib/lms/timetable";

const saturday = new Date("2026-11-28T12:00:00.000Z");

function week(weekOf: string, timezone = "UTC"): WeeklyTimetable {
  return {
    sectionId: "section-1",
    sectionName: "Morning group",
    courseId: "course-1",
    courseTitle: "Literacy",
    timezone,
    weekOf,
    weekLabel: weekOf,
    previousWeek: "2026-11-16",
    nextWeek: "2026-11-30",
    canManage: false,
    resources: [],
    days: WEEKDAYS.map((weekday, index) => ({
      weekday,
      label: weekday[0] + weekday.slice(1).toLowerCase(),
      dateLabel: `day ${index + 1}`,
      sessions: [],
    })),
  };
}

describe("today in the displayed week", () => {
  it("uses the center calendar day, including the Monday and Sunday edges", () => {
    expect(todayInDisplayedWeek("2026-11-23", "UTC", saturday)).toBe("SATURDAY");
    expect(todayInDisplayedWeek("2026-11-23", "UTC", new Date("2026-11-23T00:30:00.000Z"))).toBe("MONDAY");
    expect(todayInDisplayedWeek("2026-11-23", "UTC", new Date("2026-11-29T23:00:00.000Z"))).toBe("SUNDAY");
    // 23:00 UTC on Sunday is already Monday in Karachi. The center clock wins.
    expect(todayInDisplayedWeek("2026-11-23", "Asia/Karachi", new Date("2026-11-29T23:00:00.000Z"))).toBeNull();
    expect(todayInDisplayedWeek("2026-11-30", "Asia/Karachi", new Date("2026-11-29T23:00:00.000Z"))).toBe("MONDAY");
  });

  it("does not mark a day when today is outside this week or the clock cannot be read", () => {
    expect(todayInDisplayedWeek("2026-11-16", "UTC", saturday)).toBeNull();
    expect(todayInDisplayedWeek("2026-11-30", "UTC", saturday)).toBeNull();
    expect(todayInDisplayedWeek("not-a-date", "UTC", saturday)).toBeNull();
    expect(todayInDisplayedWeek("2026-11-23", "Not/AZone", saturday)).toBeNull();
  });

  it("highlights only today's column and keeps the week links", () => {
    const html = renderToStaticMarkup(<TimetableWeek timetable={week("2026-11-23")} now={saturday} />);
    expect(html).toContain("Previous week");
    expect(html).toContain("Next week");
    expect(html).toContain("Saturday");
    expect(html).toContain(">Today<");
    expect(html.match(/>Today</g)).toHaveLength(1);
    expect(html).toContain('aria-current="date"');
    expect(html).toContain("border-4");

    const otherWeek = renderToStaticMarkup(<TimetableWeek timetable={week("2026-11-16")} now={saturday} />);
    expect(otherWeek).not.toContain(">Today<");
    expect(otherWeek).not.toContain('aria-current="date"');
    expect(otherWeek).toContain("Previous week");
    expect(otherWeek).toContain("Next week");
  });
});
