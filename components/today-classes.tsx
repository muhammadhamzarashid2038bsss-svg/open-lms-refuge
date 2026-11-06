import Link from "next/link";
import type { TodayClass } from "@/lib/data/timetable";
import { secondaryButtonClass } from "./ui";

export function TodayClasses({ classes }: { classes: TodayClass[] }) {
  return (
    <section aria-labelledby="today-heading" className="flex flex-col gap-3">
      <h2 id="today-heading" className="text-xl font-semibold">
        Today&apos;s classes
      </h2>
      {classes.length === 0 ? <p className="text-lg">No class today.</p> : null}
      <ul className="flex flex-col gap-3">
        {classes.map((item) => (
          <li key={item.id} className="rounded-lg border-2 border-zinc-950 p-3">
            <h3 className="text-lg font-medium">{item.title}</h3>
            <p className="text-lg">
              {item.startTime} to {item.endTime}
            </p>
            <p className="text-lg">
              {item.sectionName} · {item.courseTitle}
            </p>
            <p className="text-lg">{item.deliveryLabel}</p>
            <div className="mt-3 flex flex-col gap-2">
              {item.joinHref ? (
                <a className={secondaryButtonClass} href={item.joinHref} rel="noopener noreferrer" target="_blank">
                  Join
                </a>
              ) : null}
              {item.materialHref && item.materialLabel ? (
                <a
                  className={secondaryButtonClass}
                  href={item.materialHref}
                  {...(item.materialHref.startsWith("https://")
                    ? { rel: "noopener noreferrer", target: "_blank" as const }
                    : {})}
                >
                  {item.materialLabel}
                </a>
              ) : null}
              {item.inPersonNote ? <p className="text-lg">{item.inPersonNote}</p> : null}
              {item.deliveryMode === "LIVE_ONLINE" && !item.joinHref ? (
                <p className="text-lg">The meeting link is not ready yet.</p>
              ) : null}
            </div>
            <p className="mt-3">
              <Link className="text-lg underline" href={`/sections/${item.sectionId}/timetable`}>
                See the week
              </Link>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
