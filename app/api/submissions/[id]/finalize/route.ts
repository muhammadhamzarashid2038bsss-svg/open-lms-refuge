import { getActor } from "@/lib/auth/actor";
import { finalizeSubmission } from "@/lib/data/submissions";
import { submissionDeps, submissionResponse } from "@/lib/http/submissions";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  const { id } = await context.params;
  return submissionResponse(await finalizeSubmission(actor, id, submissionDeps()));
}
