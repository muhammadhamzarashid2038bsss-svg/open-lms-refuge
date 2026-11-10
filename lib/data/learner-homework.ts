// Digital and Both homework for the signed-in learner. Paper and exams are
// not listed here. The query stays inside this learner's center and active
// enrollments. A file is not a grade.

import { Prisma } from "../../generated/prisma/client";
import type { Actor } from "../auth/permissions";
import { prisma } from "../db";
import { serverFileStatus, type ServerFileStatus } from "../lms/gradebook";

export type LearnerHomeworkItem = {
  id: string;
  title: string;
  sectionId: string;
  sectionName: string;
  courseTitle: string;
  kind: "DIGITAL" | "BOTH";
  dueAt: string | null;
  maxPoints: string;
  serverStatus: ServerFileStatus;
  serverSubmissionId: string | null;
};

function pointsText(value: Prisma.Decimal | string | number): string {
  return new Prisma.Decimal(value).toFixed(2);
}

export async function listLearnerHomework(actor: Actor): Promise<LearnerHomeworkItem[] | null> {
  if (!actor.active || actor.role !== "STUDENT" || !actor.learnerId) return null;
  const rows = await prisma.assignment.findMany({
    where: {
      kind: { in: ["DIGITAL", "BOTH"] },
      section: {
        course: { centerId: actor.centerId },
        enrollments: { some: { learnerId: actor.learnerId, status: "ACTIVE" } },
      },
    },
    orderBy: [{ dueAt: "asc" }, { title: "asc" }],
    select: {
      id: true,
      title: true,
      kind: true,
      dueAt: true,
      maxPoints: true,
      section: { select: { id: true, name: true, course: { select: { title: true } } } },
      submissions: {
        where: { learnerId: actor.learnerId },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { id: true, uploadState: true },
      },
    },
  });
  return rows.flatMap((row) => {
    if (row.kind !== "DIGITAL" && row.kind !== "BOTH") return [];
    const latest = row.submissions[0];
    return [
      {
        id: row.id,
        title: row.title,
        sectionId: row.section.id,
        sectionName: row.section.name,
        courseTitle: row.section.course.title,
        kind: row.kind,
        dueAt: row.dueAt ? row.dueAt.toISOString() : null,
        maxPoints: pointsText(row.maxPoints),
        serverStatus: serverFileStatus(latest?.uploadState ?? null),
        serverSubmissionId: latest?.uploadState === "STORED" ? latest.id : null,
      },
    ];
  });
}
