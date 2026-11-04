import { prisma } from "../db";
import type { RoleName } from "./permissions";

export type StaffCredential = {
  id: string;
  centerId: string;
  role: Exclude<RoleName, "STUDENT">;
  active: boolean;
  passwordHash: string | null;
};

export type LearnerCredential = {
  id: string;
  centerId: string;
  role: "STUDENT";
  active: boolean;
  pinHash: string | null;
};

const STAFF_ROLES = new Set<RoleName>(["TEACHER", "CENTER_DIRECTOR", "ADMIN"]);

export async function findStaffByEmail(email: string): Promise<StaffCredential | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, centerId: true, role: true, active: true, passwordHash: true },
  });
  if (!user || !STAFF_ROLES.has(user.role)) return null;
  return {
    id: user.id,
    centerId: user.centerId,
    role: user.role as StaffCredential["role"],
    active: user.active,
    passwordHash: user.passwordHash,
  };
}

export async function findLearnerByCode(
  centerCode: string,
  learnerCode: string,
): Promise<LearnerCredential | null> {
  const center = await prisma.center.findUnique({
    where: { code: centerCode },
    select: { id: true },
  });
  if (!center) return null;

  const profile = await prisma.learnerProfile.findUnique({
    where: { centerId_learnerCode: { centerId: center.id, learnerCode } },
    select: {
      pinHash: true,
      user: { select: { id: true, centerId: true, role: true, active: true } },
    },
  });
  if (!profile || profile.user.role !== "STUDENT") return null;
  return {
    id: profile.user.id,
    centerId: profile.user.centerId,
    role: "STUDENT",
    active: profile.user.active,
    pinHash: profile.pinHash,
  };
}
