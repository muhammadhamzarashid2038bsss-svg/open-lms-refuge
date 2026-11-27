import { prisma } from "../db";
import { createDeactivationHandoffs, handoffFailureMessage } from "../data/handoff";
import { writeAuditEvent } from "../data/audit";
import { hashSecret, isFourDigitPin } from "./password";
import { canResetPassword, canResetPin, canSetActive, type Actor } from "./permissions";
import { revokeSessionsForUser } from "./session-db";
import { normalizeCode, normalizeEmail } from "./login";

type Result =
  | { status: "saved"; handoff?: "teacher" | "director" | "none" }
  | { status: "hidden" }
  | { status: "invalid"; message: string };

function namedTeacher(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/// Plain sentence for the person who switched the account off.
/// "none" means the teacher had no current class, so no pack was needed.
export function handoffSwitchOffMessage(handoff: "teacher" | "director" | "none" | undefined): string {
  if (handoff === "teacher") {
    return "The account is switched off. The handoff reports were given to the teacher you chose. Older records were kept.";
  }
  if (handoff === "director") {
    return "The account is switched off. No incoming teacher was chosen, so the centre director has the handoff reports. Older records were kept.";
  }
  if (handoff === "none") {
    return "The account is switched off. They had no current class, so no handoff report was prepared. Their records were kept.";
  }
  return "The account is switched off. Their records were kept.";
}

async function learnerScope(learnerId: string) {
  return prisma.learnerProfile.findUnique({
    where: { id: learnerId },
    select: {
      id: true,
      userId: true,
      centerId: true,
      enrollments: { select: { sectionId: true } },
    },
  });
}

export async function resetLearnerPin(actor: Actor, learnerId: string, pin: string): Promise<Result> {
  if (!isFourDigitPin(pin)) return { status: "invalid", message: "A PIN is 4 digits." };
  const learner = await learnerScope(learnerId);
  if (
    !learner ||
    !canResetPin(actor, {
      id: learner.id,
      userId: learner.userId,
      centerId: learner.centerId,
      sectionIds: learner.enrollments.map((enrollment) => enrollment.sectionId),
    })
  ) {
    return { status: "hidden" };
  }

  await prisma.learnerProfile.update({
    where: { id: learner.id },
    data: { pinHash: hashSecret(pin) },
  });
  await revokeSessionsForUser(learner.userId);
  await prisma.auditLog.create({
    data: {
      centerId: learner.centerId,
      actorId: actor.id,
      action: "UPDATE",
      entityType: "USER",
      entityId: learner.userId,
      metadata: { field: "pinHash" },
    },
  });
  return { status: "saved" };
}

export async function resetPinByCode(
  actor: Actor,
  centerCode: string,
  learnerCode: string,
  pin: string,
): Promise<Result> {
  const center = await prisma.center.findUnique({
    where: { code: normalizeCode(centerCode) },
    select: { id: true },
  });
  if (!center) return { status: "hidden" };
  const profile = await prisma.learnerProfile.findUnique({
    where: { centerId_learnerCode: { centerId: center.id, learnerCode: normalizeCode(learnerCode) } },
    select: { id: true },
  });
  if (!profile) return { status: "hidden" };
  return resetLearnerPin(actor, profile.id, pin);
}

export async function resetStaffPassword(actor: Actor, userId: string, password: string): Promise<Result> {
  if (password.length < 8 || password.length > 200) {
    return { status: "invalid", message: "A password needs at least 8 characters." };
  }
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, centerId: true },
  });
  if (!target || !canResetPassword(actor, target)) return { status: "hidden" };

  await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash: hashSecret(password) },
  });
  await revokeSessionsForUser(target.id);
  await prisma.auditLog.create({
    data: {
      centerId: target.centerId,
      actorId: actor.id,
      action: "UPDATE",
      entityType: "USER",
      entityId: target.id,
      metadata: { field: "passwordHash" },
    },
  });
  return { status: "saved" };
}

export async function resetPasswordByEmail(actor: Actor, email: string, password: string): Promise<Result> {
  const target = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: { id: true },
  });
  if (!target) return { status: "hidden" };
  return resetStaffPassword(actor, target.id, password);
}

export async function setAccountActive(
  actor: Actor,
  userId: string,
  active: boolean,
  incomingTeacherId: string | null = null,
): Promise<Result> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, centerId: true, active: true },
  });
  if (!target || !canSetActive(actor, target)) return { status: "hidden" };
  // A name is only used when a teacher is switched off. Switching an account
  // on, or switching off a learner, ignores it. A blank choice is not a guess.
  const named = !active && target.role === "TEACHER" ? namedTeacher(incomingTeacherId) : null;

  // A teacher handoff has to land in the same transaction as the switch-off.
  // Repeating the switch-off finds the account already inactive and stops.
  // A second request cannot attach a teacher who was not named the first time.
  if (!active && target.role === "TEACHER") {
    try {
      return await prisma.$transaction(async (tx) => {
        const now = new Date();
        const updated = await tx.user.updateMany({
          where: { id: target.id, active: true, role: "TEACHER" },
          data: { active: false, deactivatedAt: now },
        });
        if (updated.count === 0) return { status: "saved" as const };
        const reportCount = await createDeactivationHandoffs(tx, actor, target.id, now, named);
        await tx.authSession.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: now },
        });
        await writeAuditEvent(tx, {
          actor,
          action: "DEACTIVATE",
          entityType: "USER",
          entityId: target.id,
          centerId: target.centerId,
          metadata: { active: false, reportCount, source: "account", incomingNamed: named !== null },
        });
        const handoff = reportCount === 0 ? "none" : named ? "teacher" : "director";
        return { status: "saved" as const, handoff };
      }, { timeout: 20000 });
    } catch (error) {
      return {
        status: "invalid",
        message: handoffFailureMessage(error, "The account could not be switched off. Nothing was changed."),
      };
    }
  }

  // Switching an account back on does not clear section end dates or the
  // closed-access flag. A class closed when the teacher was switched off
  // stays closed, including later the same UTC day.
  await prisma.user.update({
    where: { id: target.id },
    data: { active, deactivatedAt: active ? null : new Date() },
  });
  if (!active) await revokeSessionsForUser(target.id);
  await prisma.auditLog.create({
    data: {
      centerId: target.centerId,
      actorId: actor.id,
      action: active ? "UPDATE" : "DEACTIVATE",
      entityType: "USER",
      entityId: target.id,
      metadata: { active },
    },
  });
  return { status: "saved" };
}
