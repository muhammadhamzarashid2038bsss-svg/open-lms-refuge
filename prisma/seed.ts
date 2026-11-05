// Synthetic demo data only. Names, codes, and contact details are fake.
// Staff password for every demo account: demo-password
// Learner PIN for every demo learner: 1234
// Both are hashed before they are stored. Do not use them at a real center.
//
// Re-running this file replaces the DEMO center. Attendance and version history
// are append-only, so the reset sets a database switch that allows deletes for
// this demo wipe only. The switch does not allow edits.

import { createHash } from "node:crypto";
import { Prisma } from "../generated/prisma/client";
import { hashSecret } from "../lib/auth/password";
import { prisma } from "../lib/db";

const DEMO_PASSWORD = "demo-password";
const DEMO_PIN = "1234";

const centerId = uid(1);
const adminId = uid(2);
const directorId = uid(3);
const teacher1Id = uid(4);
const teacher2Id = uid(5);
const teacher3Id = uid(6);
const deviceMorningId = uid(7);
const deviceAfternoonId = uid(8);
const deviceOfficeId = uid(9);
const courseId = uid(10);
const sectionMorningId = uid(11);
const sectionAfternoonId = uid(12);

type SectionKey = "morning" | "afternoon";
type AttendanceStatusName = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
type ReasonName =
  | "ILLNESS"
  | "FAMILY_CARE"
  | "TRANSPORT_OR_COST"
  | "FAMILY_CIRCUMSTANCES_NOT_RECORDED"
  | "UNKNOWN";

type AttendanceRow = {
  id: string;
  clientEventId: string;
  learnerId: string;
  sessionId: string;
  status: AttendanceStatusName;
  reasonCode: ReasonName | null;
  deviceId: string;
  recordedById: string;
  recordedAt: Date;
  syncedAt: Date;
  createdOffline: boolean;
  createdAt: Date;
  learnerIndex: number;
  sessionIndex: number;
  section: SectionKey;
};

type SessionRow = {
  id: string;
  sectionId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  deliveryMode: "IN_PERSON" | "LIVE_ONLINE" | "PRE_RECORDED";
  meetingUrl: string | null;
  status: "HELD" | "CANCELLED";
  linkedResourceId: string | null;
  section: SectionKey;
  sessionIndex: number;
};

function uid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

function learnerUserId(index: number): string {
  return uid(100 + index);
}

function learnerProfileId(index: number): string {
  return uid(200 + index);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function dateOnly(year: number, monthIndex: number, day: number): Date {
  // Noon UTC keeps the calendar day stable in every timezone Prisma might use.
  return new Date(Date.UTC(year, monthIndex, day, 12, 0, 0));
}

function atUtc(day: Date, hour: number, minute: number): Date {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute));
}

function plusMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function sessionDates(): Date[] {
  const start = new Date(Date.UTC(2026, 8, 14));
  const dates: Date[] = [];
  for (let offset = 0; dates.length < 12 && offset < 50; offset += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + offset);
    const weekday = day.getUTCDay();
    if (weekday === 1 || weekday === 4) dates.push(day);
  }
  return dates;
}

function attendanceChoice(
  section: SectionKey,
  learnerIndex: number,
  sessionIndex: number,
): { status: AttendanceStatusName; reasonCode: ReasonName | null } {
  if (section === "morning" && learnerIndex === 0 && sessionIndex >= 8) {
    return { status: "ABSENT", reasonCode: null };
  }
  if (section === "afternoon" && learnerIndex === 0 && (sessionIndex === 1 || sessionIndex === 2)) {
    return { status: "EXCUSED", reasonCode: "ILLNESS" };
  }
  if (section === "morning" && learnerIndex === 1 && sessionIndex === 3) {
    return { status: "ABSENT", reasonCode: "FAMILY_CIRCUMSTANCES_NOT_RECORDED" };
  }
  if (learnerIndex === 2 && sessionIndex === 4) {
    return { status: "LATE", reasonCode: null };
  }

  const scripted =
    (section === "morning" && (learnerIndex === 0 || learnerIndex === 1 || learnerIndex === 4)) ||
    (section === "afternoon" && learnerIndex === 0) ||
    learnerIndex === 2;

  if (!scripted && (learnerIndex + sessionIndex) % 11 === 0) {
    return { status: "ABSENT", reasonCode: "TRANSPORT_OR_COST" };
  }
  return { status: "PRESENT", reasonCode: null };
}

async function createInChunks<T>(
  rows: T[],
  write: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  const size = 80;
  for (let index = 0; index < rows.length; index += size) {
    await write(rows.slice(index, index + size));
  }
}

function attendanceInsert(row: AttendanceRow) {
  return {
    id: row.id,
    clientEventId: row.clientEventId,
    learnerId: row.learnerId,
    sessionId: row.sessionId,
    status: row.status,
    reasonCode: row.reasonCode,
    deviceId: row.deviceId,
    recordedById: row.recordedById,
    recordedAt: row.recordedAt,
    syncedAt: row.syncedAt,
    createdOffline: row.createdOffline,
    createdAt: row.createdAt,
  };
}

async function wipeDemo(tx: Prisma.TransactionClient): Promise<void> {
  // Row triggers see this for the rest of the transaction. UPDATE stays blocked.
  await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;

  const center = await tx.center.findUnique({ where: { code: "DEMO" } });
  if (!center) return;

  // Sign-in rows point at users. Remove them before the demo accounts.
  // Throttle keys are hashes, so they cannot be filtered by center. This wipe
  // is the local demo reset, and it clears those counters too.
  await tx.authSession.deleteMany({ where: { user: { centerId: center.id } } });
  await tx.deviceHandover.deleteMany({ where: { centerId: center.id } });
  await tx.loginThrottle.deleteMany();

  const learners = await tx.learnerProfile.findMany({
    where: { centerId: center.id },
    select: { id: true },
  });
  const learnerIds = learners.map((row) => row.id);

  const grades = learnerIds.length
    ? await tx.gradeEntry.findMany({
        where: { learnerId: { in: learnerIds } },
        select: { id: true },
      })
    : [];
  const gradeIds = grades.map((row) => row.id);

  const notes = learnerIds.length
    ? await tx.progressNote.findMany({
        where: { learnerId: { in: learnerIds } },
        select: { id: true },
      })
    : [];
  const noteIds = notes.map((row) => row.id);

  const profiles = learnerIds.length
    ? await tx.transitionProfile.findMany({
        where: { learnerId: { in: learnerIds } },
        select: { id: true },
      })
    : [];
  const profileIds = profiles.map((row) => row.id);

  const submissions = learnerIds.length
    ? await tx.submission.findMany({
        where: { learnerId: { in: learnerIds } },
        select: { id: true },
      })
    : [];
  const submissionIds = submissions.map((row) => row.id);

  const batches = await tx.jsonSyncBatch.findMany({
    where: { centerId: center.id },
    select: { id: true },
  });
  const batchIds = batches.map((row) => row.id);

  const courses = await tx.course.findMany({
    where: { centerId: center.id },
    select: { id: true },
  });
  const courseIds = courses.map((row) => row.id);
  const sections = courseIds.length
    ? await tx.section.findMany({
        where: { courseId: { in: courseIds } },
        select: { id: true },
      })
    : [];
  const sectionIds = sections.map((row) => row.id);
  const sessions = sectionIds.length
    ? await tx.classSession.findMany({
        where: { sectionId: { in: sectionIds } },
        select: { id: true },
      })
    : [];
  const sessionIds = sessions.map((row) => row.id);
  const handoffs = sectionIds.length
    ? await tx.handoffReport.findMany({
        where: { sectionId: { in: sectionIds } },
        select: { id: true },
      })
    : [];
  const handoffIds = handoffs.map((row) => row.id);

  const conflictFilters = [
    ...(gradeIds.length ? [{ gradeEntryId: { in: gradeIds } }] : []),
    ...(noteIds.length ? [{ progressNoteId: { in: noteIds } }] : []),
  ];
  if (conflictFilters.length) {
    await tx.syncConflict.deleteMany({ where: { OR: conflictFilters } });
  }
  if (submissionIds.length) {
    await tx.fileUploadQueueItem.deleteMany({ where: { submissionId: { in: submissionIds } } });
    await tx.submission.deleteMany({ where: { id: { in: submissionIds } } });
  }
  if (batchIds.length) {
    await tx.jsonSyncItem.deleteMany({ where: { batchId: { in: batchIds } } });
    await tx.jsonSyncBatch.deleteMany({ where: { id: { in: batchIds } } });
  }
  if (gradeIds.length) {
    await tx.gradeEntryVersion.deleteMany({ where: { gradeEntryId: { in: gradeIds } } });
    await tx.gradeEntry.deleteMany({ where: { id: { in: gradeIds } } });
  }
  if (profileIds.length) {
    await tx.transitionProfileNote.deleteMany({
      where: { transitionProfileId: { in: profileIds } },
    });
    await tx.transitionProfile.deleteMany({ where: { id: { in: profileIds } } });
  }
  if (noteIds.length) {
    await tx.progressNoteVersion.deleteMany({ where: { progressNoteId: { in: noteIds } } });
    await tx.progressNote.deleteMany({ where: { id: { in: noteIds } } });
  }
  if (handoffIds.length) {
    await tx.handoffReport.deleteMany({ where: { id: { in: handoffIds } } });
  }
  if (learnerIds.length) {
    await tx.lessonProgress.deleteMany({ where: { learnerId: { in: learnerIds } } });
    await tx.attendanceRecord.deleteMany({ where: { learnerId: { in: learnerIds } } });
    await tx.learnerOptionalGender.deleteMany({ where: { learnerId: { in: learnerIds } } });
    await tx.learnerOptionalContact.deleteMany({ where: { learnerId: { in: learnerIds } } });
  }
  await tx.riskFlag.deleteMany({ where: { centerId: center.id } });
  await tx.auditLog.deleteMany({ where: { centerId: center.id } });
  if (sessionIds.length) {
    await tx.classSession.deleteMany({ where: { id: { in: sessionIds } } });
  }
  if (sectionIds.length) {
    await tx.assignment.deleteMany({ where: { sectionId: { in: sectionIds } } });
    await tx.enrollment.deleteMany({ where: { sectionId: { in: sectionIds } } });
    await tx.sectionTeacher.deleteMany({ where: { sectionId: { in: sectionIds } } });
  }
  if (courseIds.length) {
    await tx.resource.deleteMany({ where: { courseId: { in: courseIds } } });
    await tx.section.deleteMany({ where: { courseId: { in: courseIds } } });
    await tx.course.deleteMany({ where: { id: { in: courseIds } } });
  }
  if (learnerIds.length) {
    await tx.learnerProfile.deleteMany({ where: { id: { in: learnerIds } } });
  }
  await tx.device.deleteMany({ where: { centerId: center.id } });
  await tx.user.deleteMany({ where: { centerId: center.id } });
  await tx.centerOptionalField.deleteMany({ where: { centerId: center.id } });
  await tx.center.delete({ where: { id: center.id } });
}

async function main(): Promise<void> {
  const staffPassword = [
    hashSecret(DEMO_PASSWORD),
    hashSecret(DEMO_PASSWORD),
    hashSecret(DEMO_PASSWORD),
    hashSecret(DEMO_PASSWORD),
    hashSecret(DEMO_PASSWORD),
  ];
  const pinHashes = Array.from({ length: 30 }, () => hashSecret(DEMO_PIN));
  const days = sessionDates();
  const enrolledOn = dateOnly(2026, 8, 1);
  const ageBands = [
    "UNDER_6",
    "AGE_6_8",
    "AGE_9_11",
    "AGE_12_14",
    "AGE_15_17",
    "AGE_18_24",
    "AGE_25_PLUS",
  ] as const;
  const genders = ["FEMALE", "MALE", "NONBINARY", "PREFER_NOT_TO_SAY"] as const;

  const resourceIds = {
    textbook: uid(1200),
    pdf: uid(1201),
    readingList: uid(1202),
    audio: uid(1203),
    web: uid(1204),
    video: uid(1205),
  };

  const sessions: SessionRow[] = [];
  for (const section of ["morning", "afternoon"] as const) {
    days.forEach((day, sessionIndex) => {
      const cancelled = sessionIndex === 5;
      const deliveryMode = cancelled
        ? "IN_PERSON"
        : sessionIndex === 6
          ? "LIVE_ONLINE"
          : sessionIndex === 9
            ? "PRE_RECORDED"
            : "IN_PERSON";
      const startsAt = atUtc(day, section === "morning" ? 9 : 13, 0);
      sessions.push({
        id: uid(1000 + (section === "morning" ? 0 : 20) + sessionIndex),
        sectionId: section === "morning" ? sectionMorningId : sectionAfternoonId,
        title: cancelled ? `Demo session ${sessionIndex + 1} cancelled` : `Demo session ${sessionIndex + 1}`,
        startsAt,
        endsAt: plusMinutes(startsAt, 90),
        deliveryMode,
        meetingUrl:
          deliveryMode === "LIVE_ONLINE"
            ? `https://example.com/demo-live-${section}`
            : null,
        status: cancelled ? "CANCELLED" : "HELD",
        linkedResourceId:
          deliveryMode === "PRE_RECORDED"
            ? section === "morning"
              ? resourceIds.audio
              : resourceIds.pdf
            : null,
        section,
        sessionIndex,
      });
    });
  }

  const attendance: AttendanceRow[] = [];
  for (let learnerIndex = 0; learnerIndex < 30; learnerIndex += 1) {
    const section: SectionKey = learnerIndex < 15 ? "morning" : "afternoon";
    const localIndex = learnerIndex % 15;
    const sectionSessions = sessions.filter((session) => session.section === section && session.status === "HELD");
    for (const session of sectionSessions) {
      const deviceId = section === "morning" ? deviceMorningId : deviceAfternoonId;
      const recordedById = section === "morning" ? teacher1Id : teacher2Id;
      if (section === "morning" && localIndex === 4 && session.sessionIndex === 2) {
        // The phone clock on the first tap is two days ahead. The correction
        // arrives later by server time, even though its phone clock looks earlier.
        const absentSyncedAt = plusMinutes(session.startsAt, 120);
        const presentSyncedAt = plusMinutes(session.startsAt, 480);
        attendance.push({
          id: uid(10000 + attendance.length),
          clientEventId: "demo-att-morning-2-4",
          learnerId: learnerProfileId(learnerIndex),
          sessionId: session.id,
          status: "ABSENT",
          reasonCode: null,
          deviceId,
          recordedById,
          recordedAt: plusMinutes(session.startsAt, 60 * 48),
          syncedAt: absentSyncedAt,
          createdOffline: true,
          createdAt: absentSyncedAt,
          learnerIndex,
          sessionIndex: session.sessionIndex,
          section,
        });
        attendance.push({
          id: uid(10000 + attendance.length),
          clientEventId: "demo-att-morning-2-4-correction",
          learnerId: learnerProfileId(learnerIndex),
          sessionId: session.id,
          status: "PRESENT",
          reasonCode: null,
          deviceId,
          recordedById,
          recordedAt: plusMinutes(session.startsAt, 20),
          syncedAt: presentSyncedAt,
          createdOffline: true,
          createdAt: presentSyncedAt,
          learnerIndex,
          sessionIndex: session.sessionIndex,
          section,
        });
        continue;
      }

      const choice = attendanceChoice(section, localIndex, session.sessionIndex);
      const createdOffline = (learnerIndex + session.sessionIndex) % 3 === 0;
      const recordedAt = plusMinutes(session.startsAt, 10);
      const syncedAt = plusMinutes(recordedAt, createdOffline ? 180 : 1);
      attendance.push({
        id: uid(10000 + attendance.length),
        clientEventId: `demo-att-${section}-${session.sessionIndex}-${localIndex}`,
        learnerId: learnerProfileId(learnerIndex),
        sessionId: session.id,
        status: choice.status,
        reasonCode: choice.reasonCode,
        deviceId,
        recordedById,
        recordedAt,
        syncedAt,
        createdOffline,
        createdAt: syncedAt,
        learnerIndex,
        sessionIndex: session.sessionIndex,
        section,
      });
    }
  }

  const assignmentDefs = [
    { kind: "PAPER" as const, title: "Demo paper homework 1", maxPoints: "20.00", week: 2 },
    { kind: "IN_CLASS_EXAM" as const, title: "Demo paper quiz", maxPoints: "50.00", week: 4 },
    { kind: "DIGITAL" as const, title: "Demo photo homework", maxPoints: "20.00", week: 6 },
    { kind: "IN_CLASS_EXAM" as const, title: "Demo midterm paper", maxPoints: "100.00", week: 8 },
  ];

  function assignmentId(sectionIndex: number, assignmentIndex: number): string {
    return uid(1100 + sectionIndex * 10 + assignmentIndex);
  }

  function score(maxPoints: string, learnerIndex: number, assignmentIndex: number): string {
    const max = Number(maxPoints);
    const ratio = 0.55 + ((learnerIndex * 3 + assignmentIndex * 5) % 40) / 100;
    return (Math.round(ratio * max * 100) / 100).toFixed(2);
  }

  const gradeConflict = {
    gradeId: uid(3008),
    versionAId: uid(5200),
    versionBId: uid(5201),
    conflictId: uid(9500),
  };
  const noteConflict = {
    noteId: uid(6006),
    versionAId: uid(7200),
    versionBId: uid(7201),
    conflictId: uid(9501),
  };

  const morningConflictWhen = {
    earlierReceipt: new Date(Date.UTC(2026, 8, 25, 4, 0, 0)),
    laterReceipt: new Date(Date.UTC(2026, 8, 25, 8, 0, 0)),
    earlierClock: new Date(Date.UTC(2026, 8, 25, 2, 0, 0)),
    laterClock: new Date(Date.UTC(2026, 8, 25, 10, 0, 0)),
  };

  // Fifteen sequential transactions. Each phase commits before the next begins,
  // so later rows can point at parents that are already saved. The demo-reset
  // switch is local to Reset; the later transactions only insert.
  if (attendance.length !== 331) {
    throw new Error(`Expected 331 attendance records, found ${attendance.length}.`);
  }
  const attendanceFirst = attendance.slice(0, 160);
  const attendanceSecond = attendance.slice(160);
  if (attendanceFirst.length !== 160 || attendanceSecond.length !== 171) {
    throw new Error(
      `Attendance split must be 160 and 171 records, found ${attendanceFirst.length} and ${attendanceSecond.length}.`,
    );
  }
  await prisma.$transaction(
    async (tx) => {
      await wipeDemo(tx);
    },
    { timeout: 180000, maxWait: 20000 },
  );

  await prisma.$transaction(
    async (tx) => {
      await tx.center.create({
        data: {
          id: centerId,
          name: "Demo Learning Center",
          code: "DEMO",
          timezone: "UTC",
          watchRiskThreshold: 40,
          highRiskThreshold: 70,
          smallGroupSuppressionMin: 5,
        },
      });

      await tx.centerOptionalField.createMany({
        data: [
          { id: uid(30), centerId, fieldKey: "GENDER", enabled: true },
          { id: uid(31), centerId, fieldKey: "CONTACT_PHONE", enabled: false },
        ],
      });

      await tx.user.createMany({
        data: [
          {
            id: adminId,
            centerId,
            role: "ADMIN",
            email: "admin@demo.invalid",
            passwordHash: staffPassword[0],
            displayName: "Demo Admin",
            active: true,
          },
          {
            id: directorId,
            centerId,
            role: "CENTER_DIRECTOR",
            email: "director@demo.invalid",
            passwordHash: staffPassword[1],
            displayName: "Demo Director",
            active: true,
          },
          {
            id: teacher1Id,
            centerId,
            role: "TEACHER",
            email: "teacher.one@demo.invalid",
            passwordHash: staffPassword[2],
            displayName: "Demo Teacher One",
            active: true,
          },
          {
            id: teacher2Id,
            centerId,
            role: "TEACHER",
            email: "teacher.two@demo.invalid",
            passwordHash: staffPassword[3],
            displayName: "Demo Teacher Two",
            active: true,
          },
          {
            id: teacher3Id,
            centerId,
            role: "TEACHER",
            email: "teacher.three@demo.invalid",
            passwordHash: staffPassword[4],
            displayName: "Demo Teacher Three",
            active: true,
          },
          ...Array.from({ length: 30 }, (_, index) => ({
            id: learnerUserId(index),
            centerId,
            role: "STUDENT" as const,
            email: null,
            passwordHash: null,
            displayName: null,
            active: true,
          })),
        ],
      });

      await tx.device.createMany({
        data: [
          {
            id: deviceMorningId,
            centerId,
            label: "Demo morning kiosk phone",
            registeredById: teacher1Id,
            lastSeenAt: new Date(Date.UTC(2026, 9, 22, 9, 0, 0)),
          },
          {
            id: deviceAfternoonId,
            centerId,
            label: "Demo afternoon kiosk phone",
            registeredById: teacher2Id,
            lastSeenAt: new Date(Date.UTC(2026, 9, 22, 13, 0, 0)),
          },
          {
            id: deviceOfficeId,
            centerId,
            label: "Demo office laptop",
            registeredById: directorId,
            lastSeenAt: new Date(Date.UTC(2026, 9, 22, 8, 0, 0)),
          },
        ],
      });

      await tx.learnerProfile.createMany({
        data: Array.from({ length: 30 }, (_, index) => ({
          id: learnerProfileId(index),
          userId: learnerUserId(index),
          centerId,
          learnerCode: `LNR-${String(index + 1).padStart(4, "0")}`,
          displayName: `Demo Learner ${String(index + 1).padStart(2, "0")}`,
          ageBand: ageBands[index % ageBands.length],
          pinHash: pinHashes[index],
        })),
      });

      await tx.learnerOptionalGender.createMany({
        data: Array.from({ length: 30 }, (_, index) => index)
          .filter((index) => index % 2 === 0)
          .map((index) => ({
            learnerId: learnerProfileId(index),
            gender: genders[(index / 2) % genders.length],
          })),
      });

      await tx.course.create({
        data: {
          id: courseId,
          centerId,
          title: "Demo English and Number Sense",
          code: "ENG-NUM",
          academicYear: 2026,
          semester: "SEMESTER_1",
          summary: "Synthetic course for the demo center. No real learners.",
        },
      });

      await tx.section.createMany({
        data: [
          { id: sectionMorningId, courseId, name: "Morning Group" },
          { id: sectionAfternoonId, courseId, name: "Afternoon Group" },
        ],
      });

      await tx.sectionTeacher.createMany({
        data: [
          {
            id: uid(20),
            sectionId: sectionMorningId,
            teacherId: teacher1Id,
            startsOn: enrolledOn,
            endsOn: null,
          },
          {
            id: uid(21),
            sectionId: sectionMorningId,
            teacherId: teacher3Id,
            startsOn: enrolledOn,
            endsOn: null,
          },
          {
            id: uid(22),
            sectionId: sectionAfternoonId,
            teacherId: teacher3Id,
            startsOn: enrolledOn,
            endsOn: dateOnly(2026, 9, 5),
          },
          {
            id: uid(23),
            sectionId: sectionAfternoonId,
            teacherId: teacher2Id,
            startsOn: dateOnly(2026, 9, 6),
            endsOn: null,
          },
        ],
      });

      await tx.enrollment.createMany({
        data: Array.from({ length: 30 }, (_, index) => ({
          id: uid(1300 + index),
          sectionId: index < 15 ? sectionMorningId : sectionAfternoonId,
          learnerId: learnerProfileId(index),
          status: "ACTIVE" as const,
          enrolledOn,
          withdrawnOn: null,
        })),
      });

      const pdfKey = "private/demo/resources/alphabet-practice.pdf";
      const audioKey = "private/demo/resources/letter-sounds.mp3";
      await tx.resource.createMany({
        data: [
          {
            id: resourceIds.textbook,
            courseId,
            sectionId: null,
            createdById: teacher1Id,
            title: "Demo textbook link",
            resourceType: "TEXTBOOK_LINK",
            externalUrl: "https://example.com/demo-textbook",
            storageKey: null,
            mimeType: null,
            byteSize: null,
            checksumSha256: null,
            bodyText: null,
          },
          {
            id: resourceIds.pdf,
            courseId,
            sectionId: null,
            createdById: teacher1Id,
            title: "Demo alphabet practice PDF",
            resourceType: "PDF",
            externalUrl: null,
            storageKey: pdfKey,
            mimeType: "application/pdf",
            byteSize: 240000,
            checksumSha256: sha256(`synthetic-file:${pdfKey}`),
            bodyText: null,
          },
          {
            id: resourceIds.readingList,
            courseId,
            sectionId: null,
            createdById: teacher1Id,
            title: "Demo reading list",
            resourceType: "TEXT",
            externalUrl: null,
            storageKey: null,
            mimeType: null,
            byteSize: null,
            checksumSha256: null,
            bodyText:
              "Demo reading list: letters A to M, numbers 1 to 20, and three short classroom sentences.",
          },
          {
            id: resourceIds.audio,
            courseId,
            sectionId: sectionMorningId,
            createdById: teacher1Id,
            title: "Demo letter sounds",
            resourceType: "AUDIO",
            externalUrl: null,
            storageKey: audioKey,
            mimeType: "audio/mpeg",
            byteSize: 800000,
            checksumSha256: sha256(`synthetic-file:${audioKey}`),
            bodyText: null,
          },
          {
            id: resourceIds.web,
            courseId,
            sectionId: sectionAfternoonId,
            createdById: teacher2Id,
            title: "Demo number practice link",
            resourceType: "WEB_LINK",
            externalUrl: "https://example.com/demo-number-practice",
            storageKey: null,
            mimeType: null,
            byteSize: null,
            checksumSha256: null,
            bodyText: null,
          },
          {
            id: resourceIds.video,
            courseId,
            sectionId: null,
            createdById: teacher1Id,
            title: "Demo counting video link",
            resourceType: "VIDEO_LINK",
            externalUrl: "https://example.com/demo-counting-video",
            storageKey: null,
            mimeType: null,
            byteSize: null,
            checksumSha256: null,
            bodyText: null,
          },
        ],
      });

      await tx.classSession.createMany({
        data: sessions.map((session) => ({
          id: session.id,
          sectionId: session.sectionId,
          title: session.title,
          startsAt: session.startsAt,
          endsAt: session.endsAt,
          deliveryMode: session.deliveryMode,
          meetingUrl: session.meetingUrl,
          status: session.status,
          linkedResourceId: session.linkedResourceId,
        })),
      });
    },
    { timeout: 180000, maxWait: 20000 },
  );

  await prisma.$transaction(
    async (tx) => {
      await createInChunks(attendanceFirst, (chunk) =>
        tx.attendanceRecord.createMany({ data: chunk.map(attendanceInsert) }),
      );
    },
    { timeout: 180000, maxWait: 20000 },
  );

  await prisma.$transaction(
    async (tx) => {
      await createInChunks(attendanceSecond, (chunk) =>
        tx.attendanceRecord.createMany({ data: chunk.map(attendanceInsert) }),
      );
    },
    { timeout: 180000, maxWait: 20000 },
  );

  await prisma.$transaction(
    async (tx) => {
      await tx.assignment.createMany({
        data: [0, 1].flatMap((sectionIndex) =>
          assignmentDefs.map((assignment, assignmentIndex) => ({
            id: assignmentId(sectionIndex, assignmentIndex),
            sectionId: sectionIndex === 0 ? sectionMorningId : sectionAfternoonId,
            title: assignment.title,
            kind: assignment.kind,
            dueAt: atUtc(days[assignment.week], sectionIndex === 0 ? 9 : 13, 0),
            maxPoints: assignment.maxPoints,
            createdById: sectionIndex === 0 ? teacher1Id : teacher2Id,
          })),
        ),
      });
    },
    { timeout: 180000, maxWait: 20000 },
  );

      const gradeRows: Prisma.GradeEntryCreateManyInput[] = [];
      const gradeVersionRows: Prisma.GradeEntryVersionCreateManyInput[] = [];
      for (let learnerIndex = 0; learnerIndex < 30; learnerIndex += 1) {
        const sectionIndex = learnerIndex < 15 ? 0 : 1;
        const deviceId = sectionIndex === 0 ? deviceMorningId : deviceAfternoonId;
        const recordedById = sectionIndex === 0 ? teacher1Id : teacher2Id;
        for (let assignmentIndex = 0; assignmentIndex < assignmentDefs.length; assignmentIndex += 1) {
          const id =
            learnerIndex === 2 && assignmentIndex === 0
              ? gradeConflict.gradeId
              : uid(3000 + learnerIndex * 4 + assignmentIndex);
          const isConflict = id === gradeConflict.gradeId;
          const points = isConflict
            ? "14.00"
            : score(assignmentDefs[assignmentIndex].maxPoints, learnerIndex, assignmentIndex);
          const academicNote = isConflict ? "Demo note: counted 14 of 20." : null;
          const syncedAt = isConflict
            ? morningConflictWhen.laterReceipt
            : new Date(Date.UTC(2026, 8, 20 + assignmentIndex, 9, 0, 0));
          const deviceRecordedAt = isConflict
            ? morningConflictWhen.earlierClock
            : syncedAt;
          const versionVector = isConflict
            ? { [deviceOfficeId]: 1 }
            : { [deviceId]: 1 };
          const writingDevice = isConflict ? deviceOfficeId : deviceId;
          gradeRows.push({
            id,
            assignmentId: assignmentId(sectionIndex, assignmentIndex),
            learnerId: learnerProfileId(learnerIndex),
            points,
            academicNote,
            recordedById,
            deviceId: writingDevice,
            versionVector,
            deviceRecordedAt,
            syncedAt,
            createdOffline: isConflict || learnerIndex % 4 === 0,
            createdAt: syncedAt,
            updatedAt: syncedAt,
          });
          gradeVersionRows.push({
            id: isConflict ? gradeConflict.versionBId : uid(5000 + learnerIndex * 4 + assignmentIndex),
            gradeEntryId: id,
            points,
            academicNote,
            recordedById,
            deviceId: writingDevice,
            versionVector,
            deviceRecordedAt,
            syncedAt,
            createdOffline: isConflict || learnerIndex % 4 === 0,
            preservedFromConflict: isConflict,
            createdAt: syncedAt,
          });
          if (isConflict) {
            gradeVersionRows.push({
              id: gradeConflict.versionAId,
              gradeEntryId: id,
              points: "16.00",
              academicNote: "Demo note: counted 16 of 20.",
              recordedById,
              deviceId: deviceMorningId,
              versionVector: { [deviceMorningId]: 1 },
              deviceRecordedAt: morningConflictWhen.laterClock,
              syncedAt: morningConflictWhen.earlierReceipt,
              createdOffline: true,
              preservedFromConflict: true,
              createdAt: morningConflictWhen.earlierReceipt,
            });
          }
        }
      }

  await prisma.$transaction(
    async (tx) => {
      await createInChunks(gradeRows, (chunk) => tx.gradeEntry.createMany({ data: chunk }));
    },
    { timeout: 180000, maxWait: 20000 },
  );

  await prisma.$transaction(
    async (tx) => {
      await createInChunks(gradeVersionRows, (chunk) =>
        tx.gradeEntryVersion.createMany({ data: chunk }),
      );
    },
    { timeout: 180000, maxWait: 20000 },
  );

      const notePlans = [
        {
          id: uid(6001),
          learnerIndex: 0,
          authorId: teacher1Id,
          sectionId: sectionMorningId,
          deviceId: deviceMorningId,
          body: "Demo note: letter sounds for A to E are in progress.",
          skillGaps: ["READING"] as ("READING" | "WRITING" | "SPEAKING" | "NUMBER_SENSE" | "CUSTOM")[],
          customSkillLabel: null,
        },
        {
          id: uid(6002),
          learnerIndex: 1,
          authorId: teacher1Id,
          sectionId: sectionMorningId,
          deviceId: deviceMorningId,
          body: "Demo note: number cards 1 to 10 are steady.",
          skillGaps: ["NUMBER_SENSE"] as const,
          customSkillLabel: null,
        },
        {
          id: noteConflict.noteId,
          learnerIndex: 6,
          authorId: teacher1Id,
          sectionId: sectionMorningId,
          deviceId: deviceOfficeId,
          body: "Demo note: reads ten short words aloud and writes two of them.",
          skillGaps: ["READING", "WRITING"] as const,
          customSkillLabel: null,
        },
        {
          id: uid(6015),
          learnerIndex: 15,
          authorId: teacher3Id,
          sectionId: sectionAfternoonId,
          deviceId: deviceAfternoonId,
          body: "Demo note: excused lessons were repeated with number cards.",
          skillGaps: ["NUMBER_SENSE"] as const,
          customSkillLabel: null,
        },
        {
          id: uid(6016),
          learnerIndex: 16,
          authorId: teacher3Id,
          sectionId: sectionAfternoonId,
          deviceId: deviceAfternoonId,
          body: "Demo note: copying short words is steadier this month.",
          skillGaps: ["WRITING"] as const,
          customSkillLabel: null,
        },
        {
          id: uid(6017),
          learnerIndex: 17,
          authorId: teacher3Id,
          sectionId: sectionAfternoonId,
          deviceId: deviceAfternoonId,
          body: "Demo note: speaks in full classroom sentences.",
          skillGaps: ["SPEAKING"] as const,
          customSkillLabel: null,
        },
        {
          id: uid(6018),
          learnerIndex: 18,
          authorId: teacher3Id,
          sectionId: sectionAfternoonId,
          deviceId: deviceAfternoonId,
          body: "Demo note: can point to places on a simple map.",
          skillGaps: ["CUSTOM"] as const,
          customSkillLabel: "map reading",
        },
      ];

  await prisma.$transaction(
    async (tx) => {
      await tx.progressNote.createMany({
        data: notePlans.map((note) => {
          const conflict = note.id === noteConflict.noteId;
          const syncedAt = conflict
            ? morningConflictWhen.laterReceipt
            : new Date(Date.UTC(2026, 9, 10, 9, 0, 0));
          return {
            id: note.id,
            learnerId: learnerProfileId(note.learnerIndex),
            sectionId: note.sectionId,
            authorId: note.authorId,
            body: note.body,
            skillGaps: [...note.skillGaps],
            customSkillLabel: note.customSkillLabel,
            deviceId: note.deviceId,
            versionVector: conflict ? { [deviceOfficeId]: 1 } : { [note.deviceId]: 1 },
            deviceRecordedAt: conflict ? morningConflictWhen.earlierClock : syncedAt,
            syncedAt,
            createdOffline: conflict,
            createdAt: syncedAt,
            updatedAt: syncedAt,
          };
        }),
      });

      await tx.progressNoteVersion.createMany({
        data: [
          ...notePlans.map((note) => {
            const conflict = note.id === noteConflict.noteId;
            const syncedAt = conflict
              ? morningConflictWhen.laterReceipt
              : new Date(Date.UTC(2026, 9, 10, 9, 0, 0));
            return {
              id: conflict ? noteConflict.versionBId : uid(7000 + note.learnerIndex),
              progressNoteId: note.id,
              authorId: note.authorId,
              body: note.body,
              skillGaps: [...note.skillGaps],
              customSkillLabel: note.customSkillLabel,
              deviceId: note.deviceId,
              versionVector: conflict ? { [deviceOfficeId]: 1 } : { [note.deviceId]: 1 },
              deviceRecordedAt: conflict ? morningConflictWhen.earlierClock : syncedAt,
              syncedAt,
              createdOffline: conflict,
              preservedFromConflict: conflict,
              createdAt: syncedAt,
            };
          }),
          {
            id: noteConflict.versionAId,
            progressNoteId: noteConflict.noteId,
            authorId: teacher1Id,
            body: "Demo note: reads ten short words aloud.",
            skillGaps: ["READING"],
            customSkillLabel: null,
            deviceId: deviceMorningId,
            versionVector: { [deviceMorningId]: 1 },
            deviceRecordedAt: morningConflictWhen.laterClock,
            syncedAt: morningConflictWhen.earlierReceipt,
            createdOffline: true,
            preservedFromConflict: true,
            createdAt: morningConflictWhen.earlierReceipt,
          },
        ],
      });
    },
    { timeout: 180000, maxWait: 20000 },
  );

  await prisma.$transaction(
    async (tx) => {
      await tx.syncConflict.createMany({
        data: [
          {
            id: gradeConflict.conflictId,
            entityType: "GRADE_ENTRY",
            state: "OPEN",
            resolution: null,
            resolvedById: null,
            resolvedAt: null,
            gradeEntryId: gradeConflict.gradeId,
            gradeVersionAId: gradeConflict.versionAId,
            gradeVersionBId: gradeConflict.versionBId,
            shownGradeVersionId: gradeConflict.versionBId,
            progressNoteId: null,
            noteVersionAId: null,
            noteVersionBId: null,
            shownNoteVersionId: null,
          },
          {
            id: noteConflict.conflictId,
            entityType: "PROGRESS_NOTE",
            state: "OPEN",
            resolution: null,
            resolvedById: null,
            resolvedAt: null,
            gradeEntryId: null,
            gradeVersionAId: null,
            gradeVersionBId: null,
            shownGradeVersionId: null,
            progressNoteId: noteConflict.noteId,
            noteVersionAId: noteConflict.versionAId,
            noteVersionBId: noteConflict.versionBId,
            shownNoteVersionId: noteConflict.versionBId,
          },
        ],
      });
    },
    { timeout: 180000, maxWait: 20000 },
  );

      const submissionPlans = [0, 1, 2, 3].map((localIndex) => {
        const clientSubmissionId = `demo-sub-${localIndex + 1}`;
        const queued = localIndex === 3;
        const label = `synthetic-file:${clientSubmissionId}`;
        const queuedAt = new Date(Date.UTC(2026, 9, 15, 9, 30, 0));
        return {
          id: uid(8000 + localIndex),
          clientSubmissionId,
          assignmentId: assignmentId(0, 2),
          learnerId: learnerProfileId(localIndex),
          submittedById: learnerUserId(localIndex),
          uploadState: queued ? ("QUEUED" as const) : ("STORED" as const),
          byteSize: Buffer.byteLength(label),
          mimeType: "image/jpeg",
          checksumSha256: sha256(label),
          storageKey: `private/demo/submissions/${clientSubmissionId}.jpg`,
          deviceId: deviceMorningId,
          createdOffline: true,
          queuedAt,
          receivedAt: queued ? null : plusMinutes(queuedAt, 60),
          queueId: uid(8100 + localIndex),
          queueState: queued ? ("QUEUED" as const) : ("STORED" as const),
          attemptCount: queued ? 0 : 1,
        };
      });

  await prisma.$transaction(
    async (tx) => {
      await tx.submission.createMany({
        data: submissionPlans.map((row) => ({
          id: row.id,
          clientSubmissionId: row.clientSubmissionId,
          assignmentId: row.assignmentId,
          learnerId: row.learnerId,
          submittedById: row.submittedById,
          uploadState: row.uploadState,
          byteSize: row.byteSize,
          mimeType: row.mimeType,
          checksumSha256: row.checksumSha256,
          storageKey: row.storageKey,
          deviceId: row.deviceId,
          createdOffline: row.createdOffline,
          queuedAt: row.queuedAt,
          receivedAt: row.receivedAt,
        })),
      });
    },
    { timeout: 180000, maxWait: 20000 },
  );

  await prisma.$transaction(
    async (tx) => {
      await tx.fileUploadQueueItem.createMany({
        data: submissionPlans.map((row) => ({
          id: row.queueId,
          submissionId: row.id,
          state: row.queueState,
          attemptCount: row.attemptCount,
          lastErrorCode: null,
          queuedAt: row.queuedAt,
        })),
      });
    },
    { timeout: 180000, maxWait: 20000 },
  );

      const latestBySession = new Map<string, AttendanceRow>();
      for (const row of attendance) {
        const key = `${row.learnerId}:${row.sessionId}`;
        const current = latestBySession.get(key);
        if (!current || row.syncedAt > current.syncedAt) latestBySession.set(key, row);
      }

      const lessonRows: Prisma.LessonProgressCreateManyInput[] = [];
      for (const row of latestBySession.values()) {
        const session = sessions.find((item) => item.id === row.sessionId);
        if (!session) continue;
        const completed = row.status === "PRESENT" || row.status === "LATE";
        lessonRows.push({
          id: uid(20000 + lessonRows.length),
          learnerId: row.learnerId,
          classSessionId: row.sessionId,
          status: completed ? ("COMPLETED" as const) : ("NOT_STARTED" as const),
          completedAt: completed ? session.endsAt : null,
          recordedById: row.recordedById,
        });
      }
  await prisma.$transaction(
    async (tx) => {
      await createInChunks(lessonRows, (chunk) => tx.lessonProgress.createMany({ data: chunk }));
    },
    { timeout: 180000, maxWait: 20000 },
  );

      const handoffId = uid(9000);
  await prisma.$transaction(
    async (tx) => {
      await tx.handoffReport.create({
        data: {
          id: handoffId,
          sectionId: sectionAfternoonId,
          outgoingTeacherId: teacher3Id,
          incomingTeacherId: teacher2Id,
          assignedToId: teacher2Id,
          reason: "SECTION_REASSIGNED",
          status: "READY",
          generatedAt: new Date(Date.UTC(2026, 9, 6, 8, 0, 0)),
        },
      });

      const afternoonSessions = sessions.filter(
        (session) => session.section === "afternoon" && session.status === "HELD",
      );
      const profileRows = [];
      const profileNoteRows = [];
      for (let localIndex = 0; localIndex < 15; localIndex += 1) {
        const learnerIndex = 15 + localIndex;
        const learnerId = learnerProfileId(learnerIndex);
        const latest = afternoonSessions.map((session) =>
          latestBySession.get(`${learnerId}:${session.id}`),
        );
        const attended = latest.filter(
          (row) => row && (row.status === "PRESENT" || row.status === "LATE"),
        ).length;
        const unexcused = latest.filter(
          (row) =>
            row &&
            row.status === "ABSENT" &&
            row.reasonCode !== "FAMILY_CIRCUMSTANCES_NOT_RECORDED",
        ).length;
        const percents = assignmentDefs.map((assignment, assignmentIndex) => {
          const points = Number(score(assignment.maxPoints, learnerIndex, assignmentIndex));
          return points / Number(assignment.maxPoints);
        });
        const firstHalf = (percents[0] + percents[1]) / 2;
        const secondHalf = (percents[2] + percents[3]) / 2;
        const delta = secondHalf - firstHalf;
        const gradeTrend =
          delta > 0.05 ? ("IMPROVING" as const) : delta < -0.05 ? ("DECLINING" as const) : ("STEADY" as const);
        const completedLessons = lessonRows.filter(
          (row) => row.learnerId === learnerId && row.status === "COMPLETED",
        ).length;
        const learnerNotes = notePlans.filter((note) => note.learnerIndex === learnerIndex);
        const skillGaps = [...new Set(learnerNotes.flatMap((note) => [...note.skillGaps]))];
        const profileId = uid(9100 + localIndex);
        profileRows.push({
          id: profileId,
          handoffReportId: handoffId,
          learnerId,
          attendanceRate: ((attended / afternoonSessions.length) * 100).toFixed(2),
          unexcusedAbsenceCount: unexcused,
          gradeTrend,
          lessonsCompleted: completedLessons,
          lessonsTotal: afternoonSessions.length,
          skillGaps,
        });
        for (const note of learnerNotes) {
          profileNoteRows.push({ transitionProfileId: profileId, progressNoteId: note.id });
        }
      }

      await tx.transitionProfile.createMany({ data: profileRows });
      if (profileNoteRows.length) {
        await tx.transitionProfileNote.createMany({ data: profileNoteRows });
      }
    },
    { timeout: 180000, maxWait: 20000 },
  );

      const morningBatchId = uid(9600);
      const afternoonBatchId = uid(9601);
      const morningItems = attendance.filter((row) => row.section === "morning").slice(0, 2);
      const afternoonItems = attendance.filter((row) => row.section === "afternoon").slice(0, 2);
  await prisma.$transaction(
    async (tx) => {
      await tx.jsonSyncBatch.createMany({
        data: [
          {
            id: morningBatchId,
            deviceId: deviceMorningId,
            centerId,
            receivedAt: new Date(Date.UTC(2026, 9, 22, 12, 0, 0)),
            itemCount: morningItems.length,
            compressedByteSize: 480,
          },
          {
            id: afternoonBatchId,
            deviceId: deviceAfternoonId,
            centerId,
            receivedAt: new Date(Date.UTC(2026, 9, 22, 16, 0, 0)),
            itemCount: afternoonItems.length,
            compressedByteSize: 480,
          },
        ],
      });
      await tx.jsonSyncItem.createMany({
        data: [
          ...morningItems.map((row, index) => ({
            id: uid(9700 + index),
            batchId: morningBatchId,
            deviceId: deviceMorningId,
            entityType: "ATTENDANCE" as const,
            entityId: row.id,
            clientMutationId: row.clientEventId,
            status: "APPLIED" as const,
          })),
          ...afternoonItems.map((row, index) => ({
            id: uid(9710 + index),
            batchId: afternoonBatchId,
            deviceId: deviceAfternoonId,
            entityType: "ATTENDANCE" as const,
            entityId: row.id,
            clientMutationId: row.clientEventId,
            status: "APPLIED" as const,
          })),
        ],
      });
    },
    { timeout: 180000, maxWait: 20000 },
  );

      const seededAt = new Date(Date.UTC(2026, 10, 4, 0, 0, 0));
  await prisma.$transaction(
    async (tx) => {
      await tx.auditLog.createMany({
        data: [adminId, directorId, teacher1Id, teacher2Id, teacher3Id].map((entityId, index) => ({
          id: uid(9800 + index),
          centerId,
          actorId: adminId,
          action: "CREATE" as const,
          entityType: "USER" as const,
          entityId,
          deviceId: null,
          at: seededAt,
          metadata: { source: "synthetic-seed" },
        })),
      });

      const [learners, attendanceCount, grades, conflicts] = await Promise.all([
        tx.learnerProfile.count({ where: { centerId } }),
        tx.attendanceRecord.count({ where: { learner: { centerId } } }),
        tx.gradeEntry.count({ where: { learner: { centerId } } }),
        tx.syncConflict.count({ where: { state: "OPEN" } }),
      ]);

      console.log(
        `Seeded synthetic center DEMO. Learners ${learners}, attendance ${attendanceCount}, grades ${grades}, open conflicts ${conflicts}.`,
      );
    },
    { timeout: 180000, maxWait: 20000 },
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
