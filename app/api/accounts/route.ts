import { getActor } from "@/lib/auth/actor";
import { accountsResponse, toResponse } from "@/lib/http/records";

export async function GET() {
  return toResponse(await accountsResponse(await getActor()));
}
