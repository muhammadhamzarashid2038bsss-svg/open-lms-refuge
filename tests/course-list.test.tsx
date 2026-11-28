import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CourseList } from "../components/course-list";

describe("course list", () => {
  it("keeps each course on its existing page as a full-width named link", () => {
    const html = renderToStaticMarkup(
      <CourseList
        courses={[
          {
            id: "00000000-0000-4000-8000-0000000000a1",
            title: "Literacy",
            code: "LIT-1",
            academicYear: 2026,
            semester: "SEMESTER_1",
            sectionCount: 1,
          },
          {
            id: "00000000-0000-4000-8000-0000000000a2",
            title: "Numeracy",
            code: "NUM-1",
            academicYear: 2026,
            semester: "SEMESTER_2",
            sectionCount: 2,
          },
        ]}
      />,
    );
    expect(html).toContain('href="/courses/00000000-0000-4000-8000-0000000000a1"');
    expect(html).toContain('href="/courses/00000000-0000-4000-8000-0000000000a2"');
    expect(html).toContain("Literacy · LIT-1 · 2026 · Semester 1 · 1 section");
    expect(html).toContain("Numeracy · NUM-1 · 2026 · Semester 2 · 2 sections");
    const links = html.match(/<a\b[^>]*>/g) ?? [];
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toContain("min-h-12");
      expect(link).toContain("w-full");
      expect(link).toContain("focus-visible:outline");
    }
  });
});
