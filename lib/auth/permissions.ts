// Least privilege for a learning center (SYS-1).
// Learners see their own records and the materials for sections they attend.
// Teachers see the sections they are assigned to now, including learners there.
// Directors see their own center, including the optional phone number.
// Admins manage accounts. They do not get a back door into grades or notes.
// A switched-off account cannot do any of this, even if an old cookie remains.

export const ROLES = ["STUDENT", "TEACHER", "CENTER_DIRECTOR", "ADMIN"] as const;
export type RoleName = (typeof ROLES)[number];

export type Actor = {
  id: string;
  role: RoleName;
  centerId: string;
  active: boolean;
  displayName: string;
  learnerId: string | null;
  assignedSectionIds: string[];
  enrolledSectionIds: string[];
};

export type LearnerScope = {
  id: string;
  userId: string;
  centerId: string;
  sectionIds: string[];
};

export type SectionScope = {
  id: string;
  centerId: string;
};

export type ResourceScope = {
  id: string;
  centerId: string;
  sectionId: string | null;
  courseSectionIds: string[];
};

export type AccountScope = {
  id: string;
  role: RoleName;
  centerId: string;
};

function activeActor(actor: Actor): boolean {
  return actor.active;
}

function sharesCenter(actor: Actor, centerId: string): boolean {
  return actor.centerId === centerId;
}

function teacherHasSection(actor: Actor, sectionId: string): boolean {
  return actor.role === "TEACHER" && actor.assignedSectionIds.includes(sectionId);
}

function learnerHasSection(actor: Actor, sectionId: string): boolean {
  return actor.role === "STUDENT" && actor.enrolledSectionIds.includes(sectionId);
}

export function homeForRole(role: RoleName): string {
  switch (role) {
    case "STUDENT":
      return "/student";
    case "TEACHER":
      return "/teacher";
    case "CENTER_DIRECTOR":
      return "/director";
    case "ADMIN":
      return "/admin";
  }
}

export function canReadLearner(actor: Actor, learner: LearnerScope): boolean {
  if (!activeActor(actor) || !sharesCenter(actor, learner.centerId)) return false;
  if (actor.role === "STUDENT") return actor.learnerId === learner.id;
  if (actor.role === "TEACHER") {
    return learner.sectionIds.some((sectionId) => teacherHasSection(actor, sectionId));
  }
  if (actor.role === "CENTER_DIRECTOR") return true;
  return false;
}

export function canReadSection(actor: Actor, section: SectionScope): boolean {
  if (!activeActor(actor) || !sharesCenter(actor, section.centerId)) return false;
  if (actor.role === "STUDENT") return learnerHasSection(actor, section.id);
  if (actor.role === "TEACHER") return teacherHasSection(actor, section.id);
  if (actor.role === "CENTER_DIRECTOR") return true;
  return false;
}

// LMS-7 reads performance on the server. A learner can open a section timetable,
// but Day 11 does not give learners this dashboard. Admins manage accounts and
// do not receive a back door into grades. Hiding a link is not the check.
export function canViewPerformance(actor: Actor, section: SectionScope): boolean {
  if (!activeActor(actor) || !sharesCenter(actor, section.centerId)) return false;
  if (actor.role === "TEACHER") return teacherHasSection(actor, section.id);
  if (actor.role === "CENTER_DIRECTOR") return true;
  return false;
}

export function canReadResource(actor: Actor, resource: ResourceScope): boolean {
  if (!activeActor(actor) || !sharesCenter(actor, resource.centerId)) return false;
  if (actor.role === "CENTER_DIRECTOR") return true;
  if (actor.role === "ADMIN") return false;
  const sectionIds = resource.sectionId ? [resource.sectionId] : resource.courseSectionIds;
  if (actor.role === "STUDENT") return sectionIds.some((sectionId) => learnerHasSection(actor, sectionId));
  if (actor.role === "TEACHER") return sectionIds.some((sectionId) => teacherHasSection(actor, sectionId));
  return false;
}

// LMS-1: teachers change materials only for sections they staff; directors cover the center.
export function canManageCourse(actor: Actor, centerId: string): boolean {
  if (!activeActor(actor) || !sharesCenter(actor, centerId)) return false;
  return actor.role === "TEACHER" || actor.role === "CENTER_DIRECTOR";
}

// Teachers edit the timetable only for sections they are assigned to now.
// Directors cover every section in their center. Learners can look, not edit.
export function canManageTimetable(actor: Actor, section: SectionScope): boolean {
  if (!canReadSection(actor, section)) return false;
  return actor.role === "TEACHER" || actor.role === "CENTER_DIRECTOR";
}

// Kiosk attendance is a teaching task for the section the staff member can
// manage now. Learners can see the timetable. They cannot write marks.
// Admins have no teaching role, so they cannot either.
export function canRecordAttendance(actor: Actor, section: SectionScope): boolean {
  return canManageTimetable(actor, section);
}

// Grades and progress notes belong to the teacher assigned to that section now.
// A director, an admin, or a learner is not given this job only because they
// can sign in. Conflict review uses the same rule.
export function canEditAssignedRecords(actor: Actor, section: SectionScope): boolean {
  if (!activeActor(actor) || actor.role !== "TEACHER") return false;
  if (!sharesCenter(actor, section.centerId)) return false;
  return teacherHasSection(actor, section.id);
}

export function canManageResource(actor: Actor, resource: ResourceScope): boolean {
  if (!activeActor(actor) || !sharesCenter(actor, resource.centerId)) return false;
  if (actor.role === "CENTER_DIRECTOR") return true;
  if (actor.role !== "TEACHER") return false;
  const sectionIds = resource.sectionId ? [resource.sectionId] : resource.courseSectionIds;
  return sectionIds.some((sectionId) => teacherHasSection(actor, sectionId));
}

// The optional phone is director-only and is never exported (SYS-2).
export function canReadContact(actor: Actor, learner: LearnerScope): boolean {
  return activeActor(actor) && actor.role === "CENTER_DIRECTOR" && sharesCenter(actor, learner.centerId);
}

export function canListAccounts(actor: Actor, centerId: string): boolean {
  if (!activeActor(actor)) return false;
  if (actor.role === "ADMIN") return true;
  return actor.role === "CENTER_DIRECTOR" && sharesCenter(actor, centerId);
}

export function canResetPin(actor: Actor, learner: LearnerScope): boolean {
  if (!activeActor(actor)) return false;
  if (actor.role === "ADMIN") return true;
  if (!sharesCenter(actor, learner.centerId)) return false;
  if (actor.role === "CENTER_DIRECTOR") return true;
  if (actor.role === "TEACHER") {
    return learner.sectionIds.some((sectionId) => teacherHasSection(actor, sectionId));
  }
  return false;
}

export function canResetPassword(actor: Actor, target: AccountScope): boolean {
  if (!activeActor(actor)) return false;
  if (target.role === "STUDENT") return false;
  if (actor.role === "ADMIN") return true;
  return (
    actor.role === "CENTER_DIRECTOR" &&
    sharesCenter(actor, target.centerId) &&
    target.role !== "ADMIN"
  );
}

export function canSetActive(actor: Actor, target: AccountScope): boolean {
  if (!activeActor(actor) || actor.id === target.id) return false;
  if (actor.role === "ADMIN") return true;
  return (
    actor.role === "CENTER_DIRECTOR" &&
    sharesCenter(actor, target.centerId) &&
    target.role !== "ADMIN"
  );
}

export function canReleaseDevice(actor: Actor, locked: AccountScope, learnerSections: string[]): boolean {
  if (!activeActor(actor)) return false;
  if (actor.role === "ADMIN") return true;
  if (!sharesCenter(actor, locked.centerId)) return false;
  if (actor.role === "CENTER_DIRECTOR") return true;
  if (actor.role === "TEACHER" && locked.role === "STUDENT") {
    return learnerSections.some((sectionId) => teacherHasSection(actor, sectionId));
  }
  return false;
}

export function pageGuard(
  actor: Actor | null,
  role: RoleName,
): { ok: true } | { ok: false; redirectTo: string } {
  if (!actor) return { ok: false, redirectTo: "/" };
  if (actor.role !== role) return { ok: false, redirectTo: homeForRole(actor.role) };
  return { ok: true };
}
