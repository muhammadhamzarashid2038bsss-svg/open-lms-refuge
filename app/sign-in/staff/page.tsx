import Link from "next/link";
import { StaffSignInForm } from "@/components/staff-sign-in";
import { Shell } from "@/components/ui";

export default function StaffSignInPage() {
  return (
    <Shell title="Staff sign-in" lede="Teachers, directors, and admins sign in with email and a password.">
      <StaffSignInForm />
      <p className="text-lg">
        The demo password is written in docs/DATABASE.md. It is for the fake center only.
      </p>
      <Link className="text-lg underline" href="/sign-in/learner">
        Learner sign-in
      </Link>
    </Shell>
  );
}
