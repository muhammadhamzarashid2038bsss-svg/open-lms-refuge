import type { ResourceView } from "@/lib/data/records";
import { isDownloadableResource, resourceTypeLabel } from "@/lib/lms/resources";
import { RemoveResourceForm } from "./course-forms";
import { secondaryButtonClass } from "./ui";

export function ResourceList({
  resources,
  downloadableCount,
  manage,
  courseId,
}: {
  resources: ResourceView[];
  downloadableCount: number;
  manage?: boolean;
  courseId?: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Course materials</h2>
      <p className="text-lg leading-7">
        {downloadableCount === 0
          ? "No downloadable files yet."
          : `${downloadableCount} downloadable file${downloadableCount === 1 ? "" : "s"}.`}
        {" "}
        Page counts are not shown unless the center has recorded them.
      </p>
      <ul className="flex flex-col gap-3">
        {resources.map((resource) => (
          <li key={resource.id} className="rounded-lg border-2 border-zinc-950 p-3">
            <p className="text-lg font-medium">{resource.title}</p>
            <p className="text-base text-zinc-700">
              {resourceTypeLabel(resource.resourceType)}
              {resource.sectionName ? ` · ${resource.sectionName} only` : " · whole course"}
            </p>
            {resource.resourceType === "TEXT" && resource.bodyText ? (
              <p className="mt-2 whitespace-pre-wrap text-lg leading-7">{resource.bodyText}</p>
            ) : null}
            <div className="mt-3 flex flex-col gap-2">
              {resource.externalUrl ? (
                <a className={secondaryButtonClass} href={resource.externalUrl} rel="noopener noreferrer" target="_blank">
                  Open link
                </a>
              ) : null}
              {isDownloadableResource(resource.resourceType, resource.fileStatus === "private") ? (
                <a className={secondaryButtonClass} href={`/api/resources/${resource.id}/download`}>
                  Download file
                </a>
              ) : null}
              {manage && courseId ? <RemoveResourceForm courseId={courseId} resourceId={resource.id} /> : null}
            </div>
          </li>
        ))}
        {resources.length === 0 ? <li className="text-lg">No materials yet.</li> : null}
      </ul>
    </section>
  );
}
