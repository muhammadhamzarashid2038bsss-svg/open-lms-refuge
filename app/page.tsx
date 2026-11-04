import Link from "next/link";
import { Shell } from "@/components/ui";

export default function HomePage() {
  return (
    <Shell
      title="Open LMS"
      lede="Sign in for this learning center. Use the staff door or the learner door. Sign out when you finish, especially on a shared phone."
    >
      <div className="flex flex-col gap-4">
        <Link
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-zinc-950 px-4 text-lg font-medium text-white"
          href="/sign-in/staff"
        >
          Staff sign-in
        </Link>
        <Link
          className="inline-flex min-h-12 items-center justify-center rounded-lg border-2 border-zinc-950 px-4 text-lg font-medium"
          href="/sign-in/learner"
        >
          Learner sign-in
        </Link>
      </div>
    </Shell>
  );
}
