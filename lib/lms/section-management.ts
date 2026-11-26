// The director and administrator pages are server pages. This list is built
// before the phone draws the form, so it cannot live in a "use client" file.
// The interactive form receives the finished list as plain data.

import { sectionAssignmentLabel } from "./teacher-label";

export type ManagedSection = {
  id: string;
  courseTitle: string;
  sectionName: string;
  centerId: string;
  centerCode?: string;
  currentTeachers: { id: string; name: string }[];
};

export function managedSections(
  staffed: {
    id: string;
    courseTitle: string;
    sectionName: string;
    centerId: string;
    centerCode: string;
    teachers: { id: string; name: string }[];
  }[],
  unstaffed: {
    id: string;
    courseTitle: string;
    sectionName: string;
    centerId: string;
    centerCode: string;
  }[],
  showCentre: boolean,
): ManagedSection[] {
  const staffedIds = new Set(staffed.map((section) => section.id));
  const rows: ManagedSection[] = [
    ...staffed.map((section) => ({
      id: section.id,
      courseTitle: section.courseTitle,
      sectionName: section.sectionName,
      centerId: section.centerId,
      centerCode: showCentre ? section.centerCode : undefined,
      currentTeachers: section.teachers,
    })),
    ...unstaffed.filter((section) => !staffedIds.has(section.id)).map((section) => ({
      id: section.id,
      courseTitle: section.courseTitle,
      sectionName: section.sectionName,
      centerId: section.centerId,
      centerCode: showCentre ? section.centerCode : undefined,
      currentTeachers: [],
    })),
  ];
  return rows.sort((left, right) =>
    sectionAssignmentLabel(left.courseTitle, left.sectionName, left.currentTeachers.length).localeCompare(
      sectionAssignmentLabel(right.courseTitle, right.sectionName, right.currentTeachers.length),
    ),
  );
}
