// The only application path that marks an enrollment completed. There is no
// screen for this yet. Donor retention needs the date this path writes,
// because a completed enrollment has no other reliable end date.

import { Prisma } from "../../generated/prisma/client";
import type { Actor } from "../auth/permissions";
import { prisma } from "../db";
import { formatCivilDate, parseIsoDate } from "../lms/timetable";

const DENIED = "You cannot change this enrollment.";
const DATE_INVALID = "The completion date could not be read.";
const NOT_ACTIVE = "Only an active enrollment can be marked completed.";

export async function completeEnrollment(input: {
  actor: Actor | null;
  enrollmentId: string;
  completedOn: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!input.actor) return { ok: false, message: DENIED };
  const completedOn = calendarDay(input.completedOn);
  if (!completedOn) return { ok: false, message: DATE_INVALID };
  const actorId = input.actor.id;
  const enrollmentId = input.enrollmentId;

  return prisma.$transaction(async (tx) => {
    const actor = await actorFromDatabase(tx, actorId);
    if (!actor || !actor.active) return { ok: false, message: DENIED };
    if (actor.role !== "ADMIN" && actor.role !== "CENTER_DIRECTOR") return { ok: false, message: DENIED };
    const enrollment = await tx.enrollment.findUnique({
      where: { id: enrollmentId },
      select: {
        id: true,
        status: true,
        enrolledOn: true,
        learner: { select: { centerId: true } },
      },
    });
    if (!enrollment) return { ok: false, message: DENIED };
    if (actor.role === "CENTER_DIRECTOR" && actor.centerId !== enrollment.learner.centerId) {
      return { ok: false, message: DENIED };
    }
    if (enrollment.status !== "ACTIVE") return { ok: false, message: NOT_ACTIVE };
    const enrolledOn = utcDay(enrollment.enrolledOn);
    if (completedOn < enrolledOn) return { ok: false, message: DATE_INVALID };
    await tx.enrollment.update({
      where: { id: enrollment.id },
      data: { status: "COMPLETED", completedOn: utcDate(completedOn), withdrawnOn: null },
    });
    return { ok: true };
  });
}

function calendarDay(value: string): string | null {
  const parsed = parseIsoDate(value);
  return parsed ? formatCivilDate(parsed) : null;
}

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function utcDate(iso: string): Date {
  const parsed = parseIsoDate(iso);
  if (!parsed) throw new Error(DATE_INVALID);
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
}

async function actorFromDatabase(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<{ id: string; role: string; centerId: string; active: boolean } | null> {
  return tx.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, centerId: true, active: true },
  });
}
