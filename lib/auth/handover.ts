import { prisma } from "../db";
import { LOGIN_MESSAGES } from "./constants";
import { authenticateStaff } from "./login";
import { findStaffByEmail } from "./lookup";
import { loadActor } from "./load-actor";
import { canReleaseDevice } from "./permissions";
import { prismaThrottleStore } from "./prisma-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function releaseSharedDevice(input: {
  email: string;
  password: string;
  fromUserId: string;
  centerId: string;
  reason: string;
  deviceLabel: string;
  itemCount: number;
  now?: Date;
  ip: string;
}): Promise<{ ok: true; at: string } | { ok: false; error: string }> {
  const reason = input.reason.trim().replace(/\s+/g, " ");
  if (reason.length < 10 || reason.length > 200 || /^\d{4}$/.test(reason)) {
    return {
      ok: false,
      error: "Write a short reason, at least a few words. Do not type a PIN or a password.",
    };
  }
  if (!UUID.test(input.fromUserId) || !UUID.test(input.centerId)) {
    return { ok: false, error: "This phone lock could not be read. Sign in again on this phone." };
  }
  const itemCount = Number.isInteger(input.itemCount) ? input.itemCount : -1;
  if (itemCount < 0 || itemCount > 500) {
    return { ok: false, error: "The number of saved records did not look right." };
  }

  const staffLogin = await authenticateStaff({
    email: input.email,
    password: input.password,
    now: input.now ?? new Date(),
    ip: input.ip,
    store: prismaThrottleStore(),
    findStaff: findStaffByEmail,
  });
  if (!staffLogin.ok) return { ok: false, error: LOGIN_MESSAGES[staffLogin.error] };

  const staff = await loadActor(staffLogin.userId, input.now ?? new Date());
  const locked = await prisma.user.findUnique({
    where: { id: input.fromUserId },
    select: {
      id: true,
      role: true,
      centerId: true,
      learnerProfile: { select: { enrollments: { select: { sectionId: true } } } },
    },
  });
  if (!staff || !locked || locked.centerId !== input.centerId) {
    return { ok: false, error: "Those details cannot release this phone." };
  }
  const allowed = canReleaseDevice(
    staff,
    locked,
    locked.learnerProfile?.enrollments.map((enrollment) => enrollment.sectionId) ?? [],
  );
  if (!allowed) return { ok: false, error: "Those details cannot release this phone." };

  const deviceLabel = input.deviceLabel.trim().replace(/\s+/g, " ").slice(0, 80) || "shared phone";
  const handover = await prisma.deviceHandover.create({
    data: {
      centerId: locked.centerId,
      fromUserId: locked.id,
      releasedById: staff.id,
      reason,
      itemCount,
      deviceLabel,
    },
    select: { id: true, createdAt: true },
  });
  await prisma.auditLog.create({
    data: {
      centerId: locked.centerId,
      actorId: staff.id,
      action: "UPDATE",
      entityType: "USER",
      entityId: locked.id,
      metadata: { handoverId: handover.id, itemCount },
    },
  });
  return { ok: true, at: handover.createdAt.toISOString() };
}
