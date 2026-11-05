import { getActor } from "@/lib/auth/actor";
import { readResourceForDownload } from "@/lib/data/courses";
import { downloadFilename, syntheticFileBytes } from "@/lib/storage/synthetic-file";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) {
    return Response.json({ error: "Sign in required." }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const { id } = await context.params;
  const file = await readResourceForDownload(actor, id);
  if (!file) {
    return Response.json({ error: "Not found." }, { status: 404, headers: { "cache-control": "no-store" } });
  }

  const bytes = syntheticFileBytes(file.checksumSha256, file.byteSize);
  const filename = downloadFilename(file.title, file.mimeType);
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": file.mimeType ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
