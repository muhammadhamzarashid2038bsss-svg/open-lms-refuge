import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Actor } from "../lib/auth/permissions";
import { loadActor } from "../lib/auth/load-actor";
import { readResourceForDownload } from "../lib/data/courses";
import {
  createTimetableSession,
  deleteTimetableSession,
  listTodayClasses,
  readWeeklyTimetable,
  updateTimetableSession,
  type WeeklyTimetableResult,
} from "../lib/data/timetable";
import { prisma } from "../lib/db";
import {
  formatCivilDate,
  mondayOnOrBefore,
  parseIsoDate,
  validateMeetingUrl,
  validateTimetableInput,
  zonedDateTimeToUtc,
  type TimetableInput,
} from "../lib/lms/timetable";

const holder = vi.hoisted(() => ({ actor: null as Actor | null }));

vi.mock("@/lib/auth/actor", () => ({
  getActor: async () => holder.actor,
}));

import { DELETE } from "../app/api/sections/[id]/timetable/[sessionId]/route";
import { GET, POST } from "../app/api/sections/[id]/timetable/route";

const assignmentNow = new Date("2026-11-06T12:00:00.000Z");

afterAll(async () => {
  await prisma.classSession.deleteMany({ where: { title: { startsWith: "Timetable test" } } });
  await prisma.$disconnect();
});

async function actorByEmail(email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const actor = await loadActor(user.id, assignmentNow);
  if (!actor) throw new Error(`missing actor ${email}`);
  return actor;
}

async function learnerByCode(code: string) {
  const learner = await prisma.learnerProfile.findFirstOrThrow({
    where: { learnerCode: code, center: { code: "DEMO" } },
    select: { userId: true },
  });
  const actor = await loadActor(learner.userId, assignmentNow);
  if (!actor) throw new Error(`missing learner ${code}`);
  return actor;
}

function input(overrides: Partial<TimetableInput> = {}): TimetableInput {
  return {
    title: "Timetable test class",
    weekday: "MONDAY",
    startTime: "09:00",
    endTime: "10:00",
    weekOf: "2027-06-07",
    deliveryMode: "IN_PERSON",
    meetingUrl: null,
    linkedResourceId: null,
    ...overrides,
  };
}

function flatSessions(result: WeeklyTimetableResult) {
  if (result.kind !== "ok") return [];
  return result.timetable.days.flatMap((day) => day.sessions);
}

async function removeTestSessions() {
  await prisma.classSession.deleteMany({ where: { title: { startsWith: "Timetable test" } } });
}

describe("timetable rules", () => {
  it("accepts Google Meet, Zoom, and Jitsi https links and rejects anything else", () => {
    expect(validateMeetingUrl("https://meet.google.com/abc-defg-hij").ok).toBe(true);
    expect(validateMeetingUrl("https://Meet.Google.com/abc-defg-hij#skip")).toEqual({
      ok: true,
      url: "https://meet.google.com/abc-defg-hij",
    });
    expect(validateMeetingUrl("https://us02web.zoom.us/j/123456789?pwd=abc").ok).toBe(true);
    expect(validateMeetingUrl("https://zoom.us/j/123456789").ok).toBe(true);
    expect(validateMeetingUrl("https://meet.jit.si/DemoRoom").ok).toBe(true);
    expect(validateMeetingUrl("https://8x8.vc/demo/room").ok).toBe(true);

    for (const bad of [
      "http://meet.google.com/abc-defg-hij",
      "https://example.com/demo-live-morning",
      "https://meet.google.com.evil.com/abc",
      "https://evil.com@meet.google.com/abc",
      "https://meet.google.com",
      "javascript:alert(1)",
      "https://zoom.com/j/123",
      "https://meet.google.com:8443/abc",
    ]) {
      expect(validateMeetingUrl(bad).ok, bad).toBe(false);
    }
  });

  it("rejects a bad session type and an end time that is not after the start", () => {
    expect(validateTimetableInput(input({ deliveryMode: "HYBRID" })).ok).toBe(false);
    expect(validateTimetableInput(input({ endTime: "09:00" }))).toMatchObject({
      ok: false,
      message: "End time must be after the start time.",
    });
    expect(validateTimetableInput(input({ startTime: "10:00", endTime: "09:30" })).ok).toBe(false);
    expect(validateTimetableInput(input({ deliveryMode: "LIVE_ONLINE", meetingUrl: null })).ok).toBe(false);
    expect(validateTimetableInput(input({ deliveryMode: "PRE_RECORDED" })).ok).toBe(false);
    expect(
      validateTimetableInput(input({ deliveryMode: "IN_PERSON", meetingUrl: "https://meet.google.com/abc-defg-hij" })).ok,
    ).toBe(false);
    const live = validateTimetableInput(
      input({ deliveryMode: "LIVE_ONLINE", meetingUrl: "https://meet.jit.si/CenterRoom" }),
    );
    expect(live.ok).toBe(true);
    if (live.ok) expect(live.value.meetingUrl).toBe("https://meet.jit.si/CenterRoom");
  });

  it("converts a center clock time to UTC and rejects a clock time that does not exist", () => {
    expect(zonedDateTimeToUtc({ year: 2026, month: 11, day: 2, hour: 9, minute: 30 }, "UTC")?.toISOString()).toBe(
      "2026-11-02T09:30:00.000Z",
    );
    expect(
      zonedDateTimeToUtc({ year: 2026, month: 11, day: 2, hour: 9, minute: 30 }, "Asia/Kuala_Lumpur")?.toISOString(),
    ).toBe("2026-11-02T01:30:00.000Z");
    expect(
      zonedDateTimeToUtc({ year: 2026, month: 7, day: 15, hour: 9, minute: 30 }, "America/New_York")?.toISOString(),
    ).toBe("2026-07-15T13:30:00.000Z");
    expect(zonedDateTimeToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, "America/New_York")).toBeNull();
  });
});

describe("weekly timetable access", () => {
  let morningId = "";
  let afternoonId = "";
  let audioId = "";
  let afternoonWebId = "";
  let teacherOne: Actor;
  let teacherTwo: Actor;
  let teacherThree: Actor;
  let director: Actor;
  let admin: Actor;
  let morningLearner: Actor;
  let afternoonLearner: Actor;

  beforeAll(async () => {
    await removeTestSessions();
    morningId = (
      await prisma.section.findFirstOrThrow({
        where: { name: "Morning Group", course: { center: { code: "DEMO" } } },
        select: { id: true },
      })
    ).id;
    afternoonId = (
      await prisma.section.findFirstOrThrow({
        where: { name: "Afternoon Group", course: { center: { code: "DEMO" } } },
        select: { id: true },
      })
    ).id;
    audioId = (await prisma.resource.findFirstOrThrow({ where: { title: "Demo letter sounds" }, select: { id: true } })).id;
    afternoonWebId = (
      await prisma.resource.findFirstOrThrow({ where: { title: "Demo number practice link" }, select: { id: true } })
    ).id;
    teacherOne = await actorByEmail("teacher.one@demo.invalid");
    teacherTwo = await actorByEmail("teacher.two@demo.invalid");
    teacherThree = await actorByEmail("teacher.three@demo.invalid");
    director = await actorByEmail("director@demo.invalid");
    admin = await actorByEmail("admin@demo.invalid");
    morningLearner = await learnerByCode("LNR-0001");
    afternoonLearner = await learnerByCode("LNR-0016");
  });

  it("lets an assigned teacher create and retrieve a weekly class, and blocks everyone else", async () => {
    await removeTestSessions();
    try {
      const created = await createTimetableSession(
        teacherOne,
        morningId,
        input({ title: "Timetable test morning", weekOf: "2027-06-07", startTime: "09:00", endTime: "10:30" }),
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const week = readWeeklyTimetable(teacherOne, morningId, "2027-06-07");
      const teacherView = await week;
      const session = flatSessions(teacherView).find((row) => row.id === created.sessionId);
      expect(session).toMatchObject({
        weekday: "MONDAY",
        startTime: "09:00",
        endTime: "10:30",
        deliveryMode: "IN_PERSON",
        inPersonNote: "Come to class in person.",
        joinHref: null,
      });

      const learnerView = await readWeeklyTimetable(morningLearner, morningId, "2027-06-07");
      expect(flatSessions(learnerView).some((row) => row.id === created.sessionId)).toBe(true);
      expect(flatSessions(learnerView).find((row) => row.id === created.sessionId)?.meetingUrlForEdit).toBeNull();

      expect((await readWeeklyTimetable(afternoonLearner, morningId, "2027-06-07")).kind).toBe("hidden");
      expect((await readWeeklyTimetable(teacherTwo, morningId, "2027-06-07")).kind).toBe("hidden");
      expect((await readWeeklyTimetable(admin, morningId, "2027-06-07")).kind).toBe("hidden");
      expect((await createTimetableSession(teacherTwo, morningId, input({ title: "Timetable test blocked" }))).ok).toBe(
        false,
      );
      expect((await createTimetableSession(teacherThree, afternoonId, input({ title: "Timetable test old assignment" }))).ok).toBe(
        false,
      );
      expect((await createTimetableSession(morningLearner, morningId, input({ title: "Timetable test learner" }))).ok).toBe(
        false,
      );

      const directorCreated = await createTimetableSession(
        director,
        afternoonId,
        input({ title: "Timetable test director", weekOf: "2027-06-14", startTime: "13:00", endTime: "14:00" }),
      );
      expect(directorCreated.ok).toBe(true);
      if (!directorCreated.ok) return;
      const directorView = await readWeeklyTimetable(director, afternoonId, "2027-06-14");
      expect(directorView.kind).toBe("ok");
      expect(flatSessions(directorView).some((row) => row.id === directorCreated.sessionId)).toBe(true);
      expect((await readWeeklyTimetable(teacherOne, afternoonId, "2027-06-14")).kind).toBe("hidden");
    } finally {
      await removeTestSessions();
    }
  });

  it("stores a safe meeting link and opens a pre-recorded lesson through the existing resource", async () => {
    await removeTestSessions();
    try {
      const live = await createTimetableSession(
        teacherOne,
        morningId,
        input({
          title: "Timetable test live",
          weekOf: "2027-07-05",
          deliveryMode: "LIVE_ONLINE",
          meetingUrl: "https://Meet.Google.com/abc-defg-hij#ignored",
        }),
      );
      expect(live.ok).toBe(true);
      if (!live.ok) return;
      const liveView = flatSessions(await readWeeklyTimetable(morningLearner, morningId, "2027-07-05")).find(
        (row) => row.id === live.sessionId,
      );
      expect(liveView?.joinHref).toBe("https://meet.google.com/abc-defg-hij");
      expect(liveView?.meetingUrlForEdit).toBeNull();

      const bad = await createTimetableSession(
        teacherOne,
        morningId,
        input({
          title: "Timetable test bad link",
          weekOf: "2027-07-05",
          startTime: "11:00",
          endTime: "12:00",
          deliveryMode: "LIVE_ONLINE",
          meetingUrl: "https://example.com/demo-live-morning",
        }),
      );
      expect(bad).toMatchObject({ ok: false, code: "invalid" });

      const wrongSection = await createTimetableSession(
        teacherOne,
        morningId,
        input({
          title: "Timetable test wrong lesson",
          weekOf: "2027-07-05",
          startTime: "12:00",
          endTime: "13:00",
          deliveryMode: "PRE_RECORDED",
          linkedResourceId: afternoonWebId,
        }),
      );
      expect(wrongSection).toMatchObject({
        ok: false,
        message: "That lesson is not part of this section.",
      });

      const recorded = await createTimetableSession(
        teacherOne,
        morningId,
        input({
          title: "Timetable test audio",
          weekOf: "2027-07-05",
          weekday: "TUESDAY",
          startTime: "09:00",
          endTime: "09:20",
          deliveryMode: "PRE_RECORDED",
          linkedResourceId: audioId,
        }),
      );
      expect(recorded.ok).toBe(true);
      if (!recorded.ok) return;
      const audio = flatSessions(await readWeeklyTimetable(morningLearner, morningId, "2027-07-05")).find(
        (row) => row.id === recorded.sessionId,
      );
      expect(audio?.materialHref).toBe(`/api/resources/${audioId}/download`);
      expect(audio?.materialLabel).toBe("Open audio");
      expect(await readResourceForDownload(morningLearner, audioId)).not.toBeNull();
      expect(await readResourceForDownload(afternoonLearner, audioId)).toBeNull();
      expect((await readWeeklyTimetable(afternoonLearner, morningId, "2027-07-05")).kind).toBe("hidden");
    } finally {
      await removeTestSessions();
    }
  });

  it("rejects overlapping and invalid times, and allows a class that only touches another", async () => {
    await removeTestSessions();
    try {
      const first = await createTimetableSession(
        teacherOne,
        morningId,
        input({ title: "Timetable test first", weekOf: "2027-08-02", startTime: "09:00", endTime: "10:00" }),
      );
      expect(first.ok).toBe(true);
      const overlap = await createTimetableSession(
        teacherOne,
        morningId,
        input({ title: "Timetable test overlap", weekOf: "2027-08-02", startTime: "09:30", endTime: "10:30" }),
      );
      expect(overlap).toMatchObject({
        ok: false,
        message: "This time overlaps another class in this section. Pick a different time.",
      });
      const touching = await createTimetableSession(
        teacherOne,
        morningId,
        input({ title: "Timetable test next", weekOf: "2027-08-02", startTime: "10:00", endTime: "11:00" }),
      );
      expect(touching.ok).toBe(true);
      const sameClockOtherSection = await createTimetableSession(
        teacherTwo,
        afternoonId,
        input({ title: "Timetable test afternoon", weekOf: "2027-08-02", startTime: "09:00", endTime: "10:00" }),
      );
      expect(sameClockOtherSection.ok).toBe(true);
      const invalid = await createTimetableSession(
        teacherOne,
        morningId,
        input({ title: "Timetable test invalid", weekOf: "2027-08-02", startTime: "12:00", endTime: "12:00" }),
      );
      expect(invalid).toMatchObject({ ok: false, message: "End time must be after the start time." });
      expect(await prisma.classSession.count({ where: { title: "Timetable test invalid" } })).toBe(0);
      expect(await prisma.classSession.count({ where: { title: "Timetable test overlap" } })).toBe(0);
    } finally {
      await removeTestSessions();
    }
  });

  it("shows today's classes for the center weekday and skips other days and cancelled classes", async () => {
    await removeTestSessions();
    try {
      const monday = mondayOnOrBefore(parseIsoDate("2027-09-06")!);
      const weekOf = formatCivilDate(monday);
      const live = await createTimetableSession(
        teacherOne,
        morningId,
        input({
          title: "Timetable test today live",
          weekOf,
          weekday: "MONDAY",
          startTime: "09:00",
          endTime: "10:00",
          deliveryMode: "LIVE_ONLINE",
          meetingUrl: "https://zoom.us/j/123456789",
        }),
      );
      expect(live.ok).toBe(true);
      const otherDay = await createTimetableSession(
        teacherOne,
        morningId,
        input({
          title: "Timetable test tuesday",
          weekOf,
          weekday: "TUESDAY",
          startTime: "09:00",
          endTime: "10:00",
        }),
      );
      expect(otherDay.ok).toBe(true);
      const cancelled = await createTimetableSession(
        teacherOne,
        morningId,
        input({
          title: "Timetable test cancelled",
          weekOf,
          weekday: "MONDAY",
          startTime: "11:00",
          endTime: "12:00",
          deliveryMode: "IN_PERSON",
        }),
      );
      expect(cancelled.ok).toBe(true);
      if (!cancelled.ok) return;
      const cancelledUpdate = await updateTimetableSession(teacherOne, morningId, cancelled.sessionId, {
        ...input({
          title: "Timetable test cancelled",
          weekOf,
          weekday: "MONDAY",
          startTime: "11:00",
          endTime: "12:00",
        }),
        status: "CANCELLED",
      });
      expect(cancelledUpdate.ok).toBe(true);

      const during = zonedDateTimeToUtc({ ...monday, hour: 9, minute: 30 }, "UTC");
      if (!during) throw new Error("missing clock");
      const today = await listTodayClasses(morningLearner, during);
      expect(today.ok).toBe(true);
      if (!today.ok) return;
      expect(today.classes.map((row) => row.title)).toEqual(["Timetable test today live"]);
      expect(today.classes[0]).toMatchObject({
        startTime: "09:00",
        endTime: "10:00",
        sectionName: "Morning Group",
        courseTitle: "Demo English and Number Sense",
        deliveryMode: "LIVE_ONLINE",
        deliveryLabel: "Live online",
        joinHref: "https://zoom.us/j/123456789",
      });
      const afternoonToday = await listTodayClasses(afternoonLearner, during);
      expect(afternoonToday.ok).toBe(true);
      if (afternoonToday.ok) expect(afternoonToday.classes).toEqual([]);

      const recorded = await createTimetableSession(
        teacherOne,
        morningId,
        input({
          title: "Timetable test today audio",
          weekOf,
          weekday: "MONDAY",
          startTime: "13:00",
          endTime: "13:30",
          deliveryMode: "PRE_RECORDED",
          linkedResourceId: audioId,
        }),
      );
      expect(recorded.ok).toBe(true);
      const later = zonedDateTimeToUtc({ ...monday, hour: 13, minute: 10 }, "UTC");
      if (!later) throw new Error("missing later clock");
      const afternoonSlot = await listTodayClasses(morningLearner, later);
      expect(afternoonSlot.ok).toBe(true);
      if (!afternoonSlot.ok) return;
      const audioClass = afternoonSlot.classes.find((row) => row.title === "Timetable test today audio");
      expect(audioClass?.materialHref).toBe(`/api/resources/${audioId}/download`);
      expect(audioClass?.materialLabel).toBe("Open audio");
    } finally {
      await removeTestSessions();
    }
  });

  it("hides placeholder meeting links and keeps cancelled demo classes off today's list", async () => {
    const liveWeek = await readWeeklyTimetable(morningLearner, morningId, "2026-10-05");
    const live = flatSessions(liveWeek).find((row) => row.deliveryMode === "LIVE_ONLINE");
    expect(live?.joinHref).toBeNull();
    expect(live?.meetingUrlForEdit).toBeNull();
    const teacherLive = flatSessions(await readWeeklyTimetable(teacherOne, morningId, "2026-10-05")).find(
      (row) => row.deliveryMode === "LIVE_ONLINE",
    );
    expect(teacherLive?.meetingUrlForEdit).toBe("https://example.com/demo-live-morning");
    expect(teacherLive?.joinHref).toBeNull();

    const recordedWeek = await readWeeklyTimetable(morningLearner, morningId, "2026-10-12");
    const recorded = flatSessions(recordedWeek).find((row) => row.deliveryMode === "PRE_RECORDED");
    expect(recorded?.materialHref).toBe(`/api/resources/${audioId}/download`);

    const cancelledDay = await listTodayClasses(morningLearner, new Date("2026-10-01T09:30:00.000Z"));
    expect(cancelledDay).toEqual({ ok: true, classes: [] });

    const lessonDay = await listTodayClasses(morningLearner, new Date("2026-10-15T09:30:00.000Z"));
    expect(lessonDay.ok).toBe(true);
    if (!lessonDay.ok) return;
    expect(lessonDay.classes).toHaveLength(1);
    expect(lessonDay.classes[0]?.deliveryMode).toBe("PRE_RECORDED");
    expect(lessonDay.classes[0]?.materialHref).toBe(`/api/resources/${audioId}/download`);

    const held = await prisma.classSession.findFirstOrThrow({
      where: { sectionId: morningId, status: "HELD" },
      select: { id: true },
    });
    const removed = await deleteTimetableSession(teacherOne, morningId, held.id);
    expect(removed).toMatchObject({ ok: false, code: "invalid" });
    expect(await prisma.classSession.findUnique({ where: { id: held.id }, select: { id: true } })).not.toBeNull();
  });

  it("creates and reads a class through the section timetable API", async () => {
    await removeTestSessions();
    try {
      holder.actor = teacherOne;
      const created = await POST(
        new Request(`http://local.test/api/sections/${morningId}/timetable`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            input({
              title: "Timetable test http",
              weekOf: "2027-10-04",
              deliveryMode: "LIVE_ONLINE",
              meetingUrl: "https://meet.jit.si/CenterRoom",
            }),
          ),
        }),
        { params: Promise.resolve({ id: morningId }) },
      );
      expect(created.status).toBe(201);
      const createdBody = (await created.json()) as { sessionId: string };

      holder.actor = morningLearner;
      const listed = await GET(
        new Request(`http://local.test/api/sections/${morningId}/timetable?week=2027-10-04`),
        { params: Promise.resolve({ id: morningId }) },
      );
      expect(listed.status).toBe(200);
      const body = (await listed.json()) as { days: { sessions: { id: string; joinHref: string | null; meetingUrlForEdit: string | null }[] }[] };
      const session = body.days.flatMap((day) => day.sessions).find((row) => row.id === createdBody.sessionId);
      expect(session?.joinHref).toBe("https://meet.jit.si/CenterRoom");
      expect(session?.meetingUrlForEdit).toBeNull();

      holder.actor = teacherTwo;
      const blocked = await GET(new Request(`http://local.test/api/sections/${morningId}/timetable?week=2027-10-04`), {
        params: Promise.resolve({ id: morningId }),
      });
      expect(blocked.status).toBe(404);

      holder.actor = teacherOne;
      const removed = await DELETE(new Request("http://local.test/api/sections/timetable"), {
        params: Promise.resolve({ id: morningId, sessionId: createdBody.sessionId }),
      });
      expect(removed.status).toBe(200);
    } finally {
      holder.actor = null;
      await removeTestSessions();
    }
  });
});
