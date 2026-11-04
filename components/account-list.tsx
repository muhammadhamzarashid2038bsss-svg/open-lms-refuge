import { setActiveAction } from "@/app/actions/accounts";
import type { AccountView } from "@/lib/data/records";
import { secondaryButtonClass } from "./ui";

export function AccountList({ accounts }: { accounts: AccountView[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Accounts</h2>
      <p className="text-lg leading-7">Switching an account off keeps their records. They cannot sign in.</p>
      <ul className="flex flex-col gap-3">
        {accounts.map((account) => (
          <li key={account.id} className="rounded-lg border-2 border-zinc-950 p-3">
            <p className="text-lg font-medium">{account.displayName}</p>
            <p className="text-base">
              {account.role}
              {account.email ? ` · ${account.email}` : ""}
              {account.learnerCode ? ` · ${account.learnerCode}` : ""}
              {account.active ? " · on" : " · off"}
            </p>
            <form action={setActiveAction} className="mt-3">
              <input type="hidden" name="userId" value={account.id} />
              <input type="hidden" name="active" value={account.active ? "false" : "true"} />
              <button className={secondaryButtonClass} type="submit">
                {account.active ? "Switch off" : "Switch on"}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
