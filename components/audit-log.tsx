import type { AuditListRow } from "@/lib/data/handoff";
import { buttonClass, labelClass } from "./ui";

const ACTIONS = ["VIEW", "CREATE", "UPDATE", "DEACTIVATE", "EXPORT", "RESOLVE_CONFLICT", "GENERATE_HANDOFF", "UPDATE_RISK_FLAG"];
const ENTITIES = ["GRADE_ENTRY", "PROGRESS_NOTE", "HANDOFF_REPORT", "RISK_FLAG", "EXPORT", "USER", "ATTENDANCE", "SUBMISSION", "SKILL_TAG"];

export function AuditLogView({
  rows,
  actors,
  truncated,
  query,
}: {
  rows: AuditListRow[];
  actors: { id: string; name: string }[];
  truncated: boolean;
  query: { action?: string; entityType?: string; actorId?: string; from?: string; to?: string };
}) {
  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-col gap-3" method="get">
        <label className={labelClass}>
          Action
          <select className="min-h-12 rounded-lg border-2 border-zinc-950 bg-white px-3 text-lg" name="action" defaultValue={query.action ?? ""}>
            <option value="">Any</option>
            {ACTIONS.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Record type
          <select className="min-h-12 rounded-lg border-2 border-zinc-950 bg-white px-3 text-lg" name="entityType" defaultValue={query.entityType ?? ""}>
            <option value="">Any</option>
            {ENTITIES.map((entity) => (
              <option key={entity} value={entity}>
                {entity}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Actor
          <select className="min-h-12 rounded-lg border-2 border-zinc-950 bg-white px-3 text-lg" name="actorId" defaultValue={query.actorId ?? ""}>
            <option value="">Any</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          From (UTC date)
          <input className="min-h-12 rounded-lg border-2 border-zinc-950 px-3 text-lg" name="from" type="date" defaultValue={query.from ?? ""} />
        </label>
        <label className={labelClass}>
          To (UTC date)
          <input className="min-h-12 rounded-lg border-2 border-zinc-950 px-3 text-lg" name="to" type="date" defaultValue={query.to ?? ""} />
        </label>
        <button className={buttonClass} type="submit">
          Apply filters
        </button>
      </form>
      {truncated ? <p className="text-lg">Showing the latest 100 matching events.</p> : null}
      {rows.length === 0 ? <p className="text-lg">No matching events.</p> : null}
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.id} className="rounded-lg border-2 border-zinc-950 p-3">
            <p className="text-lg font-medium">
              {row.action} · {row.entityType}
            </p>
            <p className="text-base">{row.atLabel}</p>
            <p className="text-base">Actor: {row.actorName}</p>
            <p className="break-all text-base">Record: {row.entityId}</p>
            {row.centerCode ? <p className="text-base">Center: {row.centerCode}</p> : null}
            {row.metadata.length > 0 ? (
              <ul className="mt-2 text-base">
                {row.metadata.map((item) => (
                  <li key={`${row.id}-${item.key}`}>
                    {item.key}: {item.value}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
