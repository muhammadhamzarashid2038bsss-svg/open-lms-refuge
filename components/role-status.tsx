"use client";

import { useEffect, useState } from "react";
import type { RoleName } from "@/lib/auth/permissions";
import { listQueuedFiles } from "@/lib/device/file-queue";
import { HOMEWORK_QUEUE_EVENT, pendingHomeworkCount } from "@/lib/device/homework-pending";
import { AttendanceSync } from "./attendance-sync";
import { Notice } from "./notice";

type HomeworkState = { kind: "checking" } | { kind: "count"; count: number } | { kind: "unavailable" } | { kind: "missing" };

function HomeworkStatus({ userId, centerId, learnerId }: { userId: string; centerId: string; learnerId: string | null }) {
  const [state, setState] = useState<HomeworkState>(learnerId ? { kind: "checking" } : { kind: "missing" });

  useEffect(() => {
    if (!learnerId) return;
    let cancelled = false;
    const owner = { userId, centerId, learnerId };
    async function read() {
      const factory = globalThis.indexedDB;
      if (!factory) {
        if (!cancelled) setState({ kind: "unavailable" });
        return;
      }
      const listed = await listQueuedFiles(factory, owner);
      if (cancelled) return;
      if (!listed.ok) {
        setState({ kind: "unavailable" });
        return;
      }
      setState({ kind: "count", count: pendingHomeworkCount(listed.files) });
    }
    void read();
    const onChange = () => void read();
    window.addEventListener(HOMEWORK_QUEUE_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(HOMEWORK_QUEUE_EVENT, onChange);
    };
  }, [centerId, learnerId, userId]);

  if (state.kind === "missing") {
    return <Notice tone="info">Homework waiting to send is listed on the Homework page.</Notice>;
  }
  if (state.kind === "checking") {
    return (
      <p className="text-lg" role="status">
        Checking homework saved on this phone.
      </p>
    );
  }
  if (state.kind === "unavailable") {
    return <Notice tone="warning">Homework saved on this phone could not be counted. Open Homework to check.</Notice>;
  }
  if (state.count === 0) {
    return (
      <p className="text-lg" role="status">
        No homework is waiting to send.
      </p>
    );
  }
  return (
    <Notice tone="waiting">
      Homework waiting to send: {state.count}. Open Homework and choose Send pending submissions.
    </Notice>
  );
}

// Learners do not record attendance, so they do not get the attendance panel.
// Administrators have no attendance queue and no homework queue. Their phone
// count stays on the home page, where it already is. Teachers and directors
// keep the existing attendance sync, including Sync now.
export function RoleStatus({
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
  if (role === "STUDENT") return <HomeworkStatus userId={userId} centerId={centerId} learnerId={learnerId} />;
  if (role === "TEACHER" || role === "CENTER_DIRECTOR") return <AttendanceSync userId={userId} centerId={centerId} />;
  return null;
}
