// Teacher menus can show several people with the same display name, including
// the synthetic "Lock Test" accounts. The email is the real sign-in detail.
// When an account has no email, a short stable piece of its id keeps the
// choices apart without inventing an address.

export type TeacherLabelSource = {
  id: string;
  displayName: string | null;
  email: string | null;
  centerCode?: string | null;
};

function shownName(name: string | null): string {
  const trimmed = name?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : "Account";
}

export function teacherChoiceLabel(
  teacher: TeacherLabelSource,
  peers: readonly TeacherLabelSource[],
  showCentre: boolean,
): string {
  const name = shownName(teacher.displayName);
  const shared = peers.filter((peer) => shownName(peer.displayName) === name).length > 1;
  const email = teacher.email?.trim() ?? "";
  const detail = shared ? (email.length > 0 ? ` · ${email}` : ` · account ${teacher.id.slice(0, 8)}`) : "";
  const centre = showCentre && teacher.centerCode ? ` · ${teacher.centerCode}` : "";
  return `${name}${detail}${centre}`;
}

/// One line for the section menu. The count tells a director whether they are
/// giving a class its first teacher or moving an existing assignment.
export function sectionAssignmentLabel(
  courseTitle: string,
  sectionName: string,
  teacherCount: number,
  centerCode?: string,
): string {
  const status = teacherCount === 0
    ? "Unstaffed"
    : teacherCount === 1
      ? "1 current teacher"
      : `${teacherCount} current teachers`;
  const place = centerCode ? `${courseTitle} · ${sectionName} · ${centerCode}` : `${courseTitle} · ${sectionName}`;
  return `${place} — ${status}`;
}
