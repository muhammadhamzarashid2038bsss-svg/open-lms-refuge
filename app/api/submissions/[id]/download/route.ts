import { getActor } from "@/lib/auth/actor";
import { downloadSubmission } from "@/lib/data/submissions";
import { submissionDeps, submissionResponse } from "@/lib/http/submissions";

// A signed-in teacher or the learner who owns the file receives a short-lived link.
// This route does not stream the file and does not publish a permanent address.
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  const { id } = await context.params;
  return submissionResponse(await downloadSubmission(actor, id, submissionDeps()));
}
