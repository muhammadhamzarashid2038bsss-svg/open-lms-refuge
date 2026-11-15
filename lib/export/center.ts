// Decides which center a download is for. A Director's center comes from the
// account row, never from the form. An Admin may choose any center, but the
// id has to be a center that is actually stored. A switched-off account cannot
// export, even when the session object still says the account is active.

import { prisma } from "../db";
import { canonicalReportId } from "./pseudonym";

export type ExportCenterDecision =
  | { ok: true; centerId: string; role: "ADMIN" | "CENTER_DIRECTOR" }
  | { ok: false; role: "ADMIN" | "OTHER" };

export async function resolveExportCenter(input: {
  userId: string;
  postedCenterId: string | null;
}): Promise<ExportCenterDecision> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { role: true, active: true, centerId: true },
  });
  if (!user?.active) return { ok: false, role: "OTHER" };
  if (user.role === "CENTER_DIRECTOR") return { ok: true, centerId: user.centerId, role: "CENTER_DIRECTOR" };
  if (user.role !== "ADMIN") return { ok: false, role: "OTHER" };
  const centerId = canonicalReportId(input.postedCenterId ?? "");
  if (!centerId) return { ok: false, role: "ADMIN" };
  const center = await prisma.center.findUnique({ where: { id: centerId }, select: { id: true } });
  if (!center) return { ok: false, role: "ADMIN" };
  return { ok: true, centerId: center.id, role: "ADMIN" };
}
