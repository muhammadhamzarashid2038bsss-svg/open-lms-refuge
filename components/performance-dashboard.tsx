import Link from "next/link";
import type { ReactNode } from "react";
import { TRAJECTORY_RULE, type LearnerPerformance, type SectionPerformance } from "@/lib/lms/dashboard-metrics";

const tableClass = "w-full border-collapse text-left text-base";
const cellClass = "border-b border-zinc-300 p-2 align-top";
const headClass = "border-b-2 border-zinc-950 p-2 align-bottom font-semibold";

export function SectionPerformanceView({
  model,
  backHref,
  backLabel,
  learnerHref,
}: {
  model: SectionPerformance;
  backHref: string;
  backLabel: string;
  learnerHref: (learnerId: string) => string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-lg">
        <Link className="underline" href={backHref}>
          {backLabel}
        </Link>
      </p>
      <p className="text-base leading-6">{model.rule}</p>
      <SummaryList model={model} />
      <ReceiptSection
        heading="File receipts over time"
        scopeNote={model.receipts.scopeNote}
        receivedByNowLabel={model.receipts.receivedByNowLabel}
        comparisonNote={model.receipts.comparisonNote}
      >
        {model.receipts.rows.length === 0 && model.receipts.comparisonNote === "No due file assignments yet." ? (
          <p className="text-lg">This section has no digital file assignment yet.</p>
        ) : null}
        {model.receipts.rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">File receipts for {model.sectionName}, one row per file assignment, earliest due date first.</caption>
              <thead>
                <tr>
                  <th className={headClass}>Assignment</th>
                  <th className={headClass}>Due</th>
                  <th className={headClass}>Expected files</th>
                  <th className={headClass}>Received</th>
                  <th className={headClass}>Received by now</th>
                </tr>
              </thead>
              <tbody>
                {model.receipts.rows.map((row) => (
                  <tr key={row.assignmentId}>
                    <th className={`${cellClass} text-left font-medium`}>{row.title}</th>
                    <td className={cellClass}>{row.dueLabel}</td>
                    <td className={cellClass}>{row.expectedLabel}</td>
                    <td className={cellClass}>{row.receivedLabel}</td>
                    <td className={cellClass}>{row.rateLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </ReceiptSection>
      {model.learners.length === 0 ? <p className="text-lg">No learner is enrolled in this section.</p> : null}
      {model.learners.length > 0 ? (
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <caption className="sr-only">Performance for {model.sectionName}. One row per learner.</caption>
            <thead>
              <tr>
                <th className={`${headClass} sticky left-0 bg-white`}>Learner</th>
                <th className={headClass}>Grade average</th>
                <th className={headClass}>Awaiting grade</th>
                <th className={headClass}>Files submitted</th>
                <th className={headClass}>Overdue files</th>
                <th className={headClass}>Confirmed attendance</th>
                <th className={headClass}>Recording coverage</th>
                <th className={headClass}>Trajectory</th>
              </tr>
            </thead>
            <tbody>
              {model.learners.map((learner) => (
                <tr key={learner.id}>
                  <th className={`${cellClass} sticky left-0 bg-white text-left font-medium`}>
                    <Link className="underline" href={learnerHref(learner.id)}>
                      {learner.displayName}
                    </Link>
                    <span className="block font-normal text-zinc-700">{learner.learnerCode}</span>
                  </th>
                  <td className={cellClass}>{learner.gradeAverageLabel}</td>
                  <td className={cellClass}>{learner.awaitingGrade}</td>
                  <td className={cellClass}>{learner.files.submittedLabel}</td>
                  <td className={cellClass}>{learner.files.overdueLabel}</td>
                  <td className={cellClass}>{learner.attendance.confirmedLabel}</td>
                  <td className={cellClass}>{learner.attendance.coverageLabel}</td>
                  <td className={cellClass}>{learner.trajectory.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function LearnerPerformanceView({
  sectionName,
  courseTitle,
  learner,
  backHref,
  backLabel,
}: {
  sectionName: string;
  courseTitle: string;
  learner: LearnerPerformance;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-lg">
        <Link className="underline" href={backHref}>
          {backLabel}
        </Link>
      </p>
      <p className="text-lg">
        {sectionName}. {courseTitle}. Learner code {learner.learnerCode}.
      </p>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Trajectory: {learner.trajectory.label}</h2>
        <p className="text-base leading-6">{learner.trajectory.explanation}</p>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Grades and files</h2>
        <p className="text-base leading-6">
          Grade average {learner.gradeAverageLabel}. Awaiting grade {learner.awaitingGrade}. Needs review{" "}
          {learner.needsReview}. Files {learner.files.submittedLabel}. Overdue files {learner.files.overdueLabel}. A
          paper mark is not a file submission. Needs review marks are shown and left out of the average.
        </p>
        {learner.rows.length === 0 ? <p className="text-lg">This section has no assignment yet.</p> : null}
        {learner.rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">Assignments for {learner.displayName}.</caption>
              <thead>
                <tr>
                  <th className={headClass}>Assignment</th>
                  <th className={headClass}>Kind</th>
                  <th className={headClass}>Due</th>
                  <th className={headClass}>Maximum</th>
                  <th className={headClass}>Mark</th>
                  <th className={headClass}>Percent</th>
                  <th className={headClass}>Grade</th>
                  <th className={headClass}>File</th>
                </tr>
              </thead>
              <tbody>
                {learner.rows.map((row) => (
                  <tr key={row.assignmentId}>
                    <th className={`${cellClass} text-left font-medium`}>{row.title}</th>
                    <td className={cellClass}>{row.kindLabel}</td>
                    <td className={cellClass}>{row.dueLabel}</td>
                    <td className={cellClass}>{row.maxPoints}</td>
                    <td className={cellClass}>{row.pointsLabel}</td>
                    <td className={cellClass}>{row.percentLabel}</td>
                    <td className={cellClass}>{row.gradeStatus}</td>
                    <td className={cellClass}>{row.fileStatusLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      <ReceiptSection
        heading="File receipts over time"
        scopeNote={learner.receipts.scopeNote}
        receivedByNowLabel={learner.receipts.receivedByNowLabel}
        comparisonNote={learner.receipts.comparisonNote}
      >
        {learner.receipts.rows.length === 0 && learner.receipts.comparisonNote === "No due file assignments yet." ? (
          <p className="text-lg">This section has no digital file assignment yet.</p>
        ) : null}
        {learner.receipts.rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">File receipts for {learner.displayName}, earliest due date first.</caption>
              <thead>
                <tr>
                  <th className={headClass}>Assignment</th>
                  <th className={headClass}>Due</th>
                  <th className={headClass}>Result</th>
                  <th className={headClass}>Received on</th>
                </tr>
              </thead>
              <tbody>
                {learner.receipts.rows.map((row) => (
                  <tr key={row.assignmentId}>
                    <th className={`${cellClass} text-left font-medium`}>{row.title}</th>
                    <td className={cellClass}>{row.dueLabel}</td>
                    <td className={cellClass}>{row.result}</td>
                    <td className={cellClass}>{row.receivedOnLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </ReceiptSection>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Attendance</h2>
        <AttendanceDetail learner={learner} />
        {learner.sessions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">Eligible sessions for {learner.displayName}.</caption>
              <thead>
                <tr>
                  <th className={headClass}>Date</th>
                  <th className={headClass}>Class</th>
                  <th className={headClass}>Current status</th>
                </tr>
              </thead>
              <tbody>
                {learner.sessions.map((session) => (
                  <tr key={session.sessionId}>
                    <td className={cellClass}>{session.whenLabel}</td>
                    <td className={cellClass}>{session.title}</td>
                    <td className={cellClass}>{session.statusLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function CenterPerformanceView({
  sections,
  sectionHref,
}: {
  sections: SectionPerformance[];
  sectionHref: (sectionId: string) => string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base leading-6">{TRAJECTORY_RULE}</p>
      <p className="text-base leading-6">
        The counts below show how many learners have each label. A section does not receive one label of its own.
      </p>
      {sections.length === 0 ? <p className="text-lg">No sections yet.</p> : null}
      {sections.length > 0 ? (
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <caption className="sr-only">Performance for each section in this center.</caption>
            <thead>
              <tr>
                <th className={headClass}>Section</th>
                <th className={headClass}>Grade average</th>
                <th className={headClass}>Confirmed attendance</th>
                <th className={headClass}>Recording coverage</th>
                <th className={headClass}>Overdue files</th>
                <th className={headClass}>Improving</th>
                <th className={headClass}>Steady</th>
                <th className={headClass}>Declining</th>
                <th className={headClass}>Insufficient data</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => (
                <tr key={section.sectionId}>
                  <th className={`${cellClass} text-left font-medium`}>
                    <Link className="underline" href={sectionHref(section.sectionId)}>
                      {section.sectionName}
                    </Link>
                    <span className="block font-normal text-zinc-700">{section.courseTitle}</span>
                  </th>
                  <td className={cellClass}>{section.gradeAverageLabel}</td>
                  <td className={cellClass}>{section.attendance.confirmedLabel}</td>
                  <td className={cellClass}>{section.attendance.coverageLabel}</td>
                  <td className={cellClass}>{section.files.overdueLabel}</td>
                  <td className={cellClass}>{section.trajectoryCounts.Improving}</td>
                  <td className={cellClass}>{section.trajectoryCounts.Steady}</td>
                  <td className={cellClass}>{section.trajectoryCounts.Declining}</td>
                  <td className={cellClass}>{section.trajectoryCounts["Insufficient data"]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function ReceiptSection({
  heading,
  scopeNote,
  receivedByNowLabel,
  comparisonNote,
  children,
}: {
  heading: string;
  scopeNote: string;
  receivedByNowLabel: string;
  comparisonNote: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold">{heading}</h2>
      <p className="text-base leading-6">{scopeNote}</p>
      <p className="text-lg">Received by now: {receivedByNowLabel}.</p>
      <p className="text-base leading-6">{comparisonNote}</p>
      {children}
    </section>
  );
}

function SummaryList({ model }: { model: SectionPerformance }) {
  return (
    <div className="flex flex-col gap-2 text-lg">
      <p>Grade average: {model.gradeAverageLabel}. Learners in that average: {model.learnersInAverage}.</p>
      <p>Awaiting grade: {model.awaitingGrade}. Needs review: {model.needsReview}.</p>
      <p>Digital files submitted: {model.files.submittedLabel}. Overdue files: {model.files.overdueLabel}.</p>
      <p>Confirmed attendance: {model.attendance.confirmedLabel}.</p>
      <p>Recording coverage: {model.attendance.coverageLabel}.</p>
      <p>
        Unmarked eligible sessions: {model.attendance.unmarked}. Unmarked is not absent. Cancelled classes left out:{" "}
        {model.cancelledSessions}. Future classes left out: {model.futureSessions}.
      </p>
      <p>
        Trajectory: Improving {model.trajectoryCounts.Improving}, Steady {model.trajectoryCounts.Steady}, Declining{" "}
        {model.trajectoryCounts.Declining}, Insufficient data {model.trajectoryCounts["Insufficient data"]}.
      </p>
      {model.clockLabel ? <p>{model.clockLabel}</p> : null}
    </div>
  );
}

function AttendanceDetail({ learner }: { learner: LearnerPerformance }) {
  return (
    <div className="flex flex-col gap-2 text-lg">
      <p>Eligible sessions: {learner.attendance.eligibleSessions}.</p>
      <p>
        Present {learner.attendance.present}, Late {learner.attendance.late}, Absent {learner.attendance.absent}, Excused{" "}
        {learner.attendance.excused}, Unmarked {learner.attendance.unmarked}.
      </p>
      <p>Confirmed attendance: {learner.attendance.confirmedLabel}.</p>
      <p>Recording coverage: {learner.attendance.coverageLabel}.</p>
      <p>
        Cancelled classes left out: {learner.cancelledLeftOut}. Future classes left out: {learner.futureLeftOut}. The
        current status is the latest mark the server received. An older correction stays in history and is not counted
        again.
      </p>
    </div>
  );
}
