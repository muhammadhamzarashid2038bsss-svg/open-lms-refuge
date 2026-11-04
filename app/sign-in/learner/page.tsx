import Link from "next/link";
import { LearnerSignInForm } from "@/components/learner-sign-in";
import { Shell } from "@/components/ui";

export default function LearnerSignInPage() {
  return (
    <Shell title="Learner sign-in" lede="Use your learner code and 4-digit PIN.">
      <p className="text-lg leading-7">
        A short PIN is easier on a shared phone, and it is also easier to guess or to see over your shoulder. The PIN
        is stored only as a scrambled value that cannot be read back. After 5 wrong tries, the account waits 15
        minutes. Sign out when you finish so the next person does not see your records.
      </p>
      <LearnerSignInForm />
      <p className="text-lg">The demo center code is DEMO. The demo PIN is written in docs/DATABASE.md.</p>
      <Link className="text-lg underline" href="/sign-in/staff">
        Staff sign-in
      </Link>
    </Shell>
  );
}
