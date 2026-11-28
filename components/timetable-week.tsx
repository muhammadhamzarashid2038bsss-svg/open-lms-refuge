import Link from "next/link";
import type { WeeklyTimetable } from "@/lib/data/timetable";
import { todayInDisplayedWeek } from "@/lib/lms/timetable";
import { secondaryButtonClass } from "./ui";
import { AddSessionForm, EditSessionForm } from "./timetable-forms";

function ActionLinks({
  joinHref,
  materialHref,
  materialLabel,
  inPersonNote,
  liveWithoutLink,
}: {
  joinHref: string | null;
  materialHref: string | null;
  materialLabel: string | null;
  inPersonNote: string | null;
  liveWithoutLink: boolean;
}) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      {joinHref ? (
        <a className={secondaryButtonClass} href={joinHref} rel="noopener noreferrer" target="_blank">
          Join
        </a>
      ) : null}
      {materialHref && materialLabel ? (
        <a
          className={secondaryButtonClass}
          href={materialHref}
          {...(materialHref.startsWith("https://") ? { rel: "noopener noreferrer", target: "_blank" } : {})}
        >
          {materialLabel}
        </a>
      ) : null}
      {inPersonNote ? <p className="text-lg">{inPersonNote}</p> : null}
      {liveWithoutLink ? <p className="text-lg">The meeting link is not ready yet.</p> : null}
    </div>
  );
}

export function TimetableWeek({ timetable, now = new Date() }: { timetable: WeeklyTimetable; now?: Date }) {
  // Today is the center's calendar day for this week, the same clock the
  // week was built with. A phone's own weekday is not used. If that clock
  // cannot be read, or today is another week, no day is marked.
  const today = todayInDisplayedWeek(timetable.weekOf, timetable.timezone, now);
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Link className={secondaryButtonClass} href={`/sections/${timetable.sectionId}/timetable?week=${timetable.previousWeek}`}>
          Previous week
        </Link>
        <Link className={secondaryButtonClass} href={`/sections/${timetable.sectionId}/timetable?week=${timetable.nextWeek}`}>
          Next week
        </Link>
      </div>
      <p className="text-lg">Week of {timetable.weekLabel}</p>
      {/* ClassSession has no classroom column, so in-person classes are named in words only. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {timetable.days.map((day) => {
          const isToday = day.weekday === today;
          return (
          <section
            key={day.weekday}
            aria-labelledby={`day-${day.weekday}`}
            aria-current={isToday ? "date" : undefined}
            className={
              isToday
                ? "rounded-lg border-4 border-zinc-950 bg-zinc-50 p-3"
                : "rounded-lg border-2 border-zinc-950 bg-white p-3"
            }
          >
            <h2 id={`day-${day.weekday}`} className="text-xl font-semibold">
              {day.label}
              {isToday ? <span className="ml-2 text-lg font-semibold">Today</span> : null}
            </h2>
            <p className={isToday ? "text-base text-zinc-950" : "text-base text-zinc-700"}>{day.dateLabel}</p>
            {day.sessions.length === 0 ? <p className="mt-3 text-lg">No class.</p> : null}
            {day.sessions.map((session) => (
              <article key={session.id} className="mt-3 border-t-2 border-zinc-950 pt-3">
                <h3 className="text-lg font-medium">{session.title}</h3>
                <p className="text-lg">
                  {session.startTime} to {session.endTime}
                </p>
                <p className="text-lg">{session.deliveryLabel}</p>
                {session.status === "CANCELLED" ? <p className="text-lg">Cancelled</p> : null}
                <ActionLinks
                  joinHref={session.status === "CANCELLED" ? null : session.joinHref}
                  materialHref={session.status === "CANCELLED" ? null : session.materialHref}
                  materialLabel={session.materialLabel}
                  inPersonNote={session.inPersonNote}
                  liveWithoutLink={
                    session.status !== "CANCELLED" && session.deliveryMode === "LIVE_ONLINE" && !session.joinHref
                  }
                />
                {timetable.canManage ? (
                  <Link
                    className={`${secondaryButtonClass} mt-3`}
                    href={`/sections/${timetable.sectionId}/sessions/${session.id}/attendance`}
                  >
                    Take attendance
                  </Link>
                ) : null}
                {timetable.canManage ? (
                  <EditSessionForm
                    sectionId={timetable.sectionId}
                    weekOf={timetable.weekOf}
                    resources={timetable.resources}
                    session={{
                      id: session.id,
                      title: session.title,
                      weekday: session.weekday,
                      startTime: session.startTime,
                      endTime: session.endTime,
                      deliveryMode: session.deliveryMode,
                      status: session.status,
                      meetingUrl: session.meetingUrlForEdit ?? "",
                      linkedResourceId: session.linkedResourceId ?? "",
                      canDelete: session.canDelete,
                    }}
                  />
                ) : null}
              </article>
            ))}
          </section>
          );
        })}
      </div>
      {timetable.canManage ? (
        <AddSessionForm sectionId={timetable.sectionId} weekOf={timetable.weekOf} resources={timetable.resources} />
      ) : null}
    </div>
  );
}
