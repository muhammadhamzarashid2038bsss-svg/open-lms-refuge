// Server-only donor export (FEAT-4). Import this from a route or a server
// action, not from a client component. exportCenterCsv is the only operation
// that returns a file. approveFunderRequirement records a funder's written
// demand; it does not return learner data.

import { assertExportServer } from "./guard";

assertExportServer();

export { exportCenterCsv, type CenterExportResult } from "./run";
export { approveFunderRequirement, type FunderRequirementResult } from "./requirements";
export { EXPORT_DENIED, EXPORT_LIMITATION } from "./types";
