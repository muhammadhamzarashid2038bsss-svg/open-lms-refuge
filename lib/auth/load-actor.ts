import { prisma } from "../db";
import { isCurrentAssignment } from "./assignments";
import type { Actor, RoleName } from "./permissions";

type Database = {
  user: typeof prisma.user;
};

export async function loadActor(userId: string, now = new Date(), db: Database = prisma): Promise<Actor | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      centerId: true,
      active: true,
      displayName: true,
      learnerProfile: {
        select: {
          id: true,
          displayName: true,
          enrollments: { where: { status: "ACTIVE" }, select: { sectionId: true } },
        },
      },
      sectionAssignments: { select: { sectionId: true, startsOn: true, endsOn: true } },
    },
  });
  if (!user || !user.active) return null;

  const assignedSectionIds =
    user.role === "TEACHER"
      ? user.sectionAssignments
          .filter((row) => isCurrentAssignment(row.startsOn, row.endsOn, now))
          .map((row) => row.sectionId)
      : [];

  return {
    id: user.id,
    role: user.role as RoleName,
    centerId: user.centerId,
    active: user.active,
    displayName: user.learnerProfile?.displayName ?? user.displayName ?? "Account",
    learnerId: user.learnerProfile?.id ?? null,
    assignedSectionIds,
    enrolledSectionIds: user.learnerProfile?.enrollments.map((row) => row.sectionId) ?? [],
  };
}
