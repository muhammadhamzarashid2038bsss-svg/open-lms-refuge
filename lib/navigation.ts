// Role navigation uses routes that already exist. A teacher's attendance and
// gradebook open their own section lists, then the timetable or gradebook
// that was already there. They are not anchors on the teacher home.

import type { RoleName } from "@/lib/auth/permissions";

export type NavDestination = {
  id: string;
  label: string;
  href: string;
  /** always: phone and desktop. wide: desktop bar, and the More menu on a phone. menu: More/Reports only. */
  placement: "always" | "wide" | "menu";
};

export type RoleNavigation = {
  menuLabel: string | null;
  items: NavDestination[];
};

const LEARNER: NavDestination[] = [
  { id: "home", label: "Home", href: "/student", placement: "always" },
  { id: "today", label: "Today's classes", href: "/student#today", placement: "always" },
  { id: "sections", label: "My sections", href: "/student#sections", placement: "always" },
  { id: "homework", label: "Homework", href: "/student/homework", placement: "always" },
  { id: "phone", label: "This phone", href: "/student#this-phone", placement: "always" },
];

const TEACHER: NavDestination[] = [
  { id: "home", label: "Home", href: "/teacher", placement: "always" },
  { id: "sections", label: "My sections", href: "/teacher/sections", placement: "always" },
  { id: "attendance", label: "Attendance", href: "/teacher/attendance", placement: "always" },
  { id: "gradebook", label: "Gradebook", href: "/teacher/gradebook", placement: "always" },
  { id: "materials", label: "Materials", href: "/courses", placement: "wide" },
  { id: "records", label: "Save a grade or note", href: "/teacher/records", placement: "menu" },
  { id: "conflicts", label: "Conflicts", href: "/teacher/conflicts", placement: "menu" },
  { id: "handoff", label: "Handoff reports", href: "/handoff", placement: "menu" },
  { id: "phone", label: "This phone", href: "/teacher#this-phone", placement: "menu" },
];

const DIRECTOR: NavDestination[] = [
  { id: "home", label: "Home", href: "/director", placement: "always" },
  { id: "sections", label: "Sections", href: "/director#timetables", placement: "always" },
  { id: "people", label: "People", href: "/director#people", placement: "always" },
  { id: "check-ins", label: "Check-ins", href: "/director/check-ins", placement: "always" },
  { id: "performance", label: "Center performance", href: "/director/performance", placement: "menu" },
  { id: "notes", label: "Progress notes", href: "/director/notes", placement: "menu" },
  { id: "handoff", label: "Handoff reports", href: "/handoff", placement: "menu" },
  { id: "audit", label: "Audit log", href: "/audit", placement: "menu" },
  { id: "export", label: "Grant export", href: "/export", placement: "menu" },
  { id: "skill-tags", label: "Skill tags", href: "/director/skill-tags", placement: "menu" },
  { id: "courses", label: "Courses", href: "/courses", placement: "menu" },
];

const ADMIN: NavDestination[] = [
  { id: "home", label: "Home", href: "/admin", placement: "always" },
  { id: "accounts", label: "Accounts", href: "/admin#accounts", placement: "always" },
  { id: "sections", label: "Sections", href: "/admin#sections", placement: "always" },
  { id: "audit", label: "Audit", href: "/audit", placement: "always" },
  { id: "export", label: "Export", href: "/export", placement: "always" },
];

const MENUS: Record<RoleName, string | null> = {
  STUDENT: null,
  TEACHER: "More",
  CENTER_DIRECTOR: "Reports",
  ADMIN: null,
};

// Paths the nav is allowed to name. Hash targets are the same page.
// Shared screens (/courses, /handoff, /audit, /export, timetables) appear
// only for roles that can already open them.
const ALLOWED_PATHS: Record<RoleName, readonly string[]> = {
  STUDENT: ["/student", "/student/homework"],
  TEACHER: [
    "/teacher",
    "/teacher/sections",
    "/teacher/attendance",
    "/teacher/gradebook",
    "/teacher/records",
    "/teacher/conflicts",
    "/courses",
    "/handoff",
  ],
  CENTER_DIRECTOR: [
    "/director",
    "/director/check-ins",
    "/director/performance",
    "/director/notes",
    "/director/skill-tags",
    "/courses",
    "/handoff",
    "/audit",
    "/export",
  ],
  ADMIN: ["/admin", "/audit", "/export"],
};

export function roleLabel(role: RoleName): string {
  switch (role) {
    case "STUDENT":
      return "Learner";
    case "TEACHER":
      return "Teacher";
    case "CENTER_DIRECTOR":
      return "Centre director";
    case "ADMIN":
      return "Administrator";
  }
}

export function navigationFor(role: RoleName): RoleNavigation {
  const items = role === "STUDENT" ? LEARNER : role === "TEACHER" ? TEACHER : role === "CENTER_DIRECTOR" ? DIRECTOR : ADMIN;
  return { menuLabel: MENUS[role], items };
}

export function hrefPath(href: string): string {
  const path = href.split("#")[0] ?? href;
  return path.length === 0 ? "/" : path;
}

export function navigationHrefs(role: RoleName): string[] {
  return navigationFor(role).items.map((item) => item.href);
}

export function navigationUsesOnlyAllowedPaths(role: RoleName): boolean {
  const allowed = new Set(ALLOWED_PATHS[role]);
  return navigationHrefs(role).every((href) => allowed.has(hrefPath(href)));
}

// A same-page section is a normal hash link. A full app-router link to the
// page you are already on does not report the hash change, so the previous
// item stayed highlighted.
export function visibleHref(href: string, pathname: string): string {
  const path = hrefPath(href);
  const mark = href.includes("#") ? href.slice(href.indexOf("#")) : "";
  const here = normPath(pathname);
  if (here === path && mark) return mark;
  if (here === path) return path;
  return href;
}

// "same" is only the page already open. A link with no hash, such as
// /student/homework, used to match every page and the tap was cancelled.
export function linkKind(href: string, pathname: string): "hash" | "same" | "route" {
  const path = hrefPath(href);
  const shown = visibleHref(href, pathname);
  if (shown.startsWith("#")) return "hash";
  if (shown === path && normPath(pathname) === path) return "same";
  return "route";
}

function normPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function normHash(hash: string): string {
  if (!hash || hash === "#") return "";
  return hash.startsWith("#") ? hash : `#${hash}`;
}

function isTimetable(path: string): boolean {
  return /^\/sections\/[^/]+\/timetable$/.test(path);
}

function isAttendance(path: string): boolean {
  return /^\/sections\/[^/]+\/sessions\/[^/]+\/attendance$/.test(path);
}

function currentLearner(path: string, hash: string): string {
  if (path === "/student/homework") return "homework";
  if (path.startsWith("/student/sections/") || isTimetable(path)) return "sections";
  if (path === "/student" && hash === "#today") return "today";
  if (path === "/student" && hash === "#sections") return "sections";
  if (path === "/student" && hash === "#this-phone") return "phone";
  if (path === "/student") return "home";
  return "home";
}

function currentTeacher(path: string, hash: string): string {
  if (path === "/courses" || path.startsWith("/courses/")) return "materials";
  if (path === "/teacher/attendance") return "attendance";
  if (path === "/teacher/gradebook") return "gradebook";
  if (path === "/teacher/sections") return "sections";
  if (/^\/teacher\/sections\/[^/]+\/gradebook$/.test(path)) return "gradebook";
  if (path.startsWith("/teacher/sections/") && path.includes("/performance")) return "sections";
  if (isTimetable(path) || isAttendance(path)) return "attendance";
  if (path === "/teacher/records") return "records";
  if (path === "/teacher/conflicts" || path.startsWith("/teacher/conflicts/")) return "conflicts";
  if (path === "/handoff" || path.startsWith("/handoff/")) return "handoff";
  if (path === "/teacher" && hash === "#this-phone") return "phone";
  if (path === "/teacher") return "home";
  return "home";
}

function currentDirector(path: string, hash: string): string {
  if (path === "/director/check-ins") return "check-ins";
  if (path === "/director/performance" || /^\/director\/sections\/[^/]+\/performance/.test(path)) return "performance";
  if (path === "/director/notes" || path.startsWith("/director/notes/")) return "notes";
  if (path === "/handoff" || path.startsWith("/handoff/")) return "handoff";
  if (path === "/audit") return "audit";
  if (path === "/export") return "export";
  if (path === "/director/skill-tags") return "skill-tags";
  if (path === "/courses" || path.startsWith("/courses/")) return "courses";
  if (isTimetable(path) || isAttendance(path)) return "sections";
  if (path === "/director" && hash === "#timetables") return "sections";
  if (path === "/director" && hash === "#people") return "people";
  if (path === "/director") return "home";
  return "home";
}

function currentAdmin(path: string, hash: string): string {
  if (path === "/audit") return "audit";
  if (path === "/export") return "export";
  if (path === "/admin" && hash === "#accounts") return "accounts";
  if (path === "/admin" && hash === "#sections") return "sections";
  if (path === "/admin") return "home";
  return "home";
}

export function currentDestinationId(role: RoleName, pathname: string, hash: string): string {
  const path = normPath(pathname);
  const mark = normHash(hash);
  switch (role) {
    case "STUDENT":
      return currentLearner(path, mark);
    case "TEACHER":
      return currentTeacher(path, mark);
    case "CENTER_DIRECTOR":
      return currentDirector(path, mark);
    case "ADMIN":
      return currentAdmin(path, mark);
  }
}
