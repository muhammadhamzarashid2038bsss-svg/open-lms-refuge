// The homework file queue already stores each file's status. A file that is
// not yet "submitted" is still on the phone. This count only reads that
// status. It does not upload, and it does not create a second queue.

export const HOMEWORK_QUEUE_EVENT = "olr-homework-queue";

export function pendingHomeworkCount(files: { status: string }[]): number {
  return files.filter((file) => file.status !== "submitted").length;
}
