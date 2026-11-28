"use client";

import { useEffect, useRef } from "react";
import type { RoleName } from "@/lib/auth/permissions";
import { roleLabel } from "@/lib/navigation";
import { productName } from "@/lib/product";
import { RoleNav } from "./role-nav";
import { RoleStatus } from "./role-status";
import { SignOutButton } from "./sign-out-button";

export function SignedChrome({
  role,
  userId,
  centerId,
  learnerId,
}: {
  role: RoleName;
  userId: string;
  centerId: string;
  learnerId: string | null;
}) {
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    // Section links use this height so a heading is not hidden under the
    // header. Measuring it keeps a wrapped phone nav and a desktop nav honest.
    const apply = () => {
      document.documentElement.style.setProperty("--app-header-height", `${Math.ceil(header.getBoundingClientRect().height)}px`);
    };
    apply();
    if (typeof ResizeObserver !== "function") {
      return () => {
        document.documentElement.style.removeProperty("--app-header-height");
      };
    }
    const observer = new ResizeObserver(apply);
    observer.observe(header);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--app-header-height");
    };
  }, []);
  return (
    <div className="print:hidden">
      {/* Fixed, not sticky. Focusing a sticky control scrolls to its place in
          the document, which is the top, so a tap jumped the page and the
          click landed on a different item. */}
      <header ref={headerRef} className="fixed inset-x-0 top-0 z-20 border-b-2 border-zinc-950 bg-white">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg font-semibold leading-tight">{productName}</p>
              <p className="text-base leading-6">
                <span className="sr-only">Signed in as </span>
                {roleLabel(role)}
              </p>
            </div>
            <SignOutButton />
          </div>
          <RoleNav role={role} />
        </div>
      </header>
      <div aria-hidden="true" style={{ height: "var(--app-header-height, 12rem)" }} />
      <div className="mx-auto w-full max-w-3xl px-4 pt-4">
        <RoleStatus role={role} userId={userId} centerId={centerId} learnerId={learnerId} />
      </div>
    </div>
  );
}
