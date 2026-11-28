import type { ReactNode } from "react";

// An administrator does not take attendance, so the header has no sync panel.
// This phone stays at the bottom, where the waiting-record count already is.
// Audit and export stay in the menu so this page does not list them again.

export function AdminDashboard({
  notice,
  sections,
  accounts,
  phone,
}: {
  notice: ReactNode;
  sections: ReactNode;
  accounts: ReactNode;
  phone: ReactNode;
}) {
  return (
    <>
      {notice}
      <section id="sections" data-nav-target="" aria-labelledby="sections-heading" className="flex flex-col gap-3">
        <h2 id="sections-heading" className="text-xl font-semibold">
          Sections
        </h2>
        {sections}
      </section>
      <section id="accounts" data-nav-target="" aria-labelledby="accounts-heading" className="flex flex-col gap-6">
        <h2 id="accounts-heading" className="text-xl font-semibold">
          Accounts
        </h2>
        {accounts}
      </section>
      {phone}
    </>
  );
}
