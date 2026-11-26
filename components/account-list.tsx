import { setActiveAction } from "@/app/actions/accounts";
import type { AccountView } from "@/lib/data/records";
import { labelClass, secondaryButtonClass } from "./ui";

export function AccountList({
  accounts,
  incomingTeachers,
  blankIncomingLabel,
  fallbackText,
  emptyTeacherText,
}: {
  accounts: AccountView[];
  incomingTeachers: { id: string; name: string; centerId: string }[];
  blankIncomingLabel: string;
  fallbackText: string;
  emptyTeacherText: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Accounts</h2>
      <p className="text-lg leading-7">
        Switching an account off keeps their records. They cannot sign in, and an open session is closed.
      </p>
      <p className="text-lg leading-7">
        When you switch a teacher off, choose the teacher who is taking over their classes. That person receives one
        handoff report for each class and is added to those classes so they can open it. Their old class assignments
        are closed and are not opened again if the account is switched back on. A teacher who was switched
        off from a class today cannot be given that same class again until the next UTC day. {fallbackText} To give different
        classes to different teachers, use Manage section assignments first.
      </p>
      <ul className="flex flex-col gap-3">
        {accounts.map((account) => {
          const takingOver =
            account.role === "TEACHER" && account.active
              ? incomingTeachers.filter((teacher) => teacher.centerId === account.centerId && teacher.id !== account.id)
              : [];
          return (
            <li key={account.id} className="rounded-lg border-2 border-zinc-950 p-3">
              <p className="text-lg font-medium">{account.displayName}</p>
              <p className="text-base">
                {account.role}
                {account.email ? ` · ${account.email}` : ""}
                {account.learnerCode ? ` · ${account.learnerCode}` : ""}
                {account.active ? " · on" : " · off"}
              </p>
              <form action={setActiveAction} className="mt-3 flex flex-col gap-3">
                <input type="hidden" name="userId" value={account.id} />
                <input type="hidden" name="active" value={account.active ? "false" : "true"} />
                {account.role === "TEACHER" && account.active ? (
                  <label className={labelClass}>
                    Who is taking over?
                    <select
                      className="min-h-12 w-full rounded-lg border-2 border-zinc-950 bg-white px-3 text-lg"
                      name="incomingTeacherId"
                      defaultValue=""
                    >
                      <option value="">{blankIncomingLabel}</option>
                      {takingOver.map((teacher) => (
                        <option key={teacher.id} value={teacher.id}>
                          {teacher.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {account.role === "TEACHER" && account.active && takingOver.length === 0 ? (
                  <p className="text-base leading-6">{emptyTeacherText}</p>
                ) : null}
                <button className={secondaryButtonClass} type="submit">
                  {account.active ? "Switch off" : "Switch on"}
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
