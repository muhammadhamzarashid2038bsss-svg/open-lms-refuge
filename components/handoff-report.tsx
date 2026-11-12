import Link from "next/link";
import type { HandoffView } from "@/lib/data/handoff";
import { PrintButton } from "./print-button";

export function HandoffReportView({
  report,
  printHref,
  backHref,
}: {
  report: HandoffView;
  printHref?: string;
  backHref: string;
}) {
  return (
    <article className="flex flex-col gap-6">
      <p className="text-lg print:hidden">
        <Link className="underline" href={backHref}>
          Back
        </Link>
        {printHref ? (
          <>
            {" · "}
            <Link className="underline" href={printHref}>
              Open the print page
            </Link>
          </>
        ) : null}
      </p>
      {printHref ? null : <PrintButton />}
      <p className="text-lg leading-7">
        {report.centerName}. {report.courseTitle}. {report.sectionName}.
      </p>
      <dl className="flex flex-col gap-2 text-lg">
        <div>
          <dt className="font-semibold">Outgoing teacher</dt>
          <dd>{report.outgoingName}</dd>
        </div>
        <div>
          <dt className="font-semibold">Incoming teacher</dt>
          <dd>{report.incomingName ?? "No single incoming teacher was identified."}</dd>
        </div>
        <div>
          <dt className="font-semibold">Recipient</dt>
          <dd>{report.recipientName}</dd>
        </div>
        <div>
          <dt className="font-semibold">Reason</dt>
          <dd>{report.reasonLabel}</dd>
        </div>
        <div>
          <dt className="font-semibold">Prepared</dt>
          <dd>{report.generatedAtLabel}</dd>
        </div>
        <div>
          <dt className="font-semibold">Learners</dt>
          <dd>{report.learnerCount}</dd>
        </div>
      </dl>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Section summary</h2>
        <p className="text-lg leading-7">Attendance: {report.attendanceSummary}</p>
        <p className="text-lg leading-7">Grade trends: {report.gradeSummary}</p>
        <p className="text-lg leading-7">Lesson completion: {report.lessonSummary}</p>
      </section>
      {report.profiles.map((profile) => (
        <section key={profile.id} className="flex flex-col gap-2 border-t-2 border-zinc-950 pt-4">
          <h2 className="text-xl font-semibold">
            {profile.learnerName}
            <span className="block text-base font-normal">{profile.learnerCode}</span>
          </h2>
          {profile.enrolledOn ? <p className="text-lg">Enrolled {profile.enrolledOn}. Active in this section at the handoff.</p> : null}
          <p className="text-lg leading-7">Attendance: {profile.attendanceLabel}</p>
          <p className="text-base leading-6">{profile.attendanceDetail}</p>
          <p className="text-lg leading-7">{profile.unexcusedLabel}</p>
          <p className="text-lg leading-7">Grades: {profile.gradeLabel}</p>
          <p className="text-base leading-6">{profile.gradeDetail}</p>
          {profile.marks.length > 0 ? (
            <ul className="flex flex-col gap-1 text-lg">
              {profile.marks.map((mark) => (
                <li key={`${profile.id}-${mark.title}-${mark.percent}`}>
                  {mark.title}: {mark.percent}%
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-lg">No settled mark was stored on this page.</p>
          )}
          <p className="text-lg leading-7">Lessons: {profile.lessonLabel}</p>
          <p className="text-lg leading-7">
            Skill gaps: {profile.skillLabels.length > 0 ? profile.skillLabels.join(", ") : "None recorded"}
          </p>
          {profile.notes.length === 0 ? <p className="text-lg">No progress note was linked.</p> : null}
          {profile.notes.map((note) => (
            <div key={note.noteId} className="rounded-lg border-2 border-zinc-950 p-3">
              <p className="text-base">
                {note.versionId ? `Saved version ${note.recordedAt ?? ""}`.trim() : "Linked note without a saved version"}
              </p>
              {note.skillLabels.length > 0 ? <p className="text-base">{note.skillLabels.join(", ")}</p> : null}
              {note.body ? <p className="text-lg leading-7">{note.body}</p> : <p className="text-lg">The note text from that day was not stored on this link.</p>}
            </div>
          ))}
        </section>
      ))}
    </article>
  );
}
