import { getActor } from "@/lib/auth/actor";
import { initiateSubmission } from "@/lib/data/submissions";
import { readSubmissionJson, submissionDeps, submissionResponse } from "@/lib/http/submissions";

export async function POST(request: Request) {
  const actor = await getActor();
  const body = await readSubmissionJson(request);
  if (!body.ok) return submissionResponse(body.result);
  return submissionResponse(await initiateSubmission(actor, body.value, submissionDeps()));
}
