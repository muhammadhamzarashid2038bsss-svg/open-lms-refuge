-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('STUDENT', 'TEACHER', 'CENTER_DIRECTOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "AgeBand" AS ENUM ('UNDER_6', 'AGE_6_8', 'AGE_9_11', 'AGE_12_14', 'AGE_15_17', 'AGE_18_24', 'AGE_25_PLUS');

-- CreateEnum
CREATE TYPE "OptionalFieldKey" AS ENUM ('GENDER', 'CONTACT_PHONE');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('FEMALE', 'MALE', 'NONBINARY', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "Semester" AS ENUM ('SEMESTER_1', 'SEMESTER_2');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('PDF', 'TEXT', 'TEXTBOOK_LINK', 'AUDIO', 'VIDEO_LINK', 'WEB_LINK');

-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('IN_PERSON', 'LIVE_ONLINE', 'PRE_RECORDED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'HELD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateEnum
CREATE TYPE "AbsenceReasonCode" AS ENUM ('ILLNESS', 'FAMILY_CARE', 'TRANSPORT_OR_COST', 'FAMILY_CIRCUMSTANCES_NOT_RECORDED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AssignmentKind" AS ENUM ('PAPER', 'DIGITAL', 'IN_CLASS_EXAM');

-- CreateEnum
CREATE TYPE "UploadState" AS ENUM ('QUEUED', 'UPLOADING', 'STORED', 'FAILED');

-- CreateEnum
CREATE TYPE "FileQueueState" AS ENUM ('QUEUED', 'UPLOADING', 'STORED', 'FAILED');

-- CreateEnum
CREATE TYPE "FileErrorCode" AS ENUM ('CHECKSUM_MISMATCH', 'TOO_LARGE', 'STORAGE_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "LessonStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SkillGap" AS ENUM ('READING', 'WRITING', 'SPEAKING', 'NUMBER_SENSE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "HandoffReason" AS ENUM ('TEACHER_DEACTIVATED', 'SECTION_REASSIGNED');

-- CreateEnum
CREATE TYPE "HandoffStatus" AS ENUM ('READY', 'ACKNOWLEDGED');

-- CreateEnum
CREATE TYPE "TrendLabel" AS ENUM ('IMPROVING', 'STEADY', 'DECLINING', 'INSUFFICIENT');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('INSUFFICIENT_DATA', 'NONE', 'WATCH', 'HIGH');

-- CreateEnum
CREATE TYPE "RiskFlagStatus" AS ENUM ('OPEN', 'CHECK_IN_DONE', 'DISMISSED');

-- CreateEnum
CREATE TYPE "RiskDismissReason" AS ENUM ('NOT_NEEDED', 'ALREADY_SUPPORTED', 'DATA_ERROR');

-- CreateEnum
CREATE TYPE "RiskReasonCode" AS ENUM ('CONSECUTIVE_UNEXCUSED_ABSENCES', 'MISSING_ASSIGNMENTS', 'GRADE_SLOPE', 'CHECK_IN_SUGGESTED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('VIEW', 'CREATE', 'UPDATE', 'DEACTIVATE', 'EXPORT', 'RESOLVE_CONFLICT', 'GENERATE_HANDOFF', 'UPDATE_RISK_FLAG');

-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('GRADE_ENTRY', 'PROGRESS_NOTE', 'HANDOFF_REPORT', 'RISK_FLAG', 'EXPORT', 'USER', 'ATTENDANCE', 'SUBMISSION');

-- CreateEnum
CREATE TYPE "SyncEntityType" AS ENUM ('GRADE_ENTRY', 'PROGRESS_NOTE');

-- CreateEnum
CREATE TYPE "ConflictState" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ConflictResolution" AS ENUM ('KEPT_LATER_RECEIVED', 'KEPT_OTHER_VERSION', 'MERGED');

-- CreateEnum
CREATE TYPE "JsonSyncEntityType" AS ENUM ('ATTENDANCE', 'GRADE_ENTRY', 'PROGRESS_NOTE', 'LESSON_PROGRESS');

-- CreateEnum
CREATE TYPE "JsonSyncItemStatus" AS ENUM ('RECEIVED', 'APPLIED', 'DUPLICATE', 'CONFLICT', 'REJECTED');

-- CreateTable
CREATE TABLE "centers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "watchRiskThreshold" INTEGER NOT NULL DEFAULT 40,
    "highRiskThreshold" INTEGER NOT NULL DEFAULT 70,
    "smallGroupSuppressionMin" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "center_optional_fields" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "fieldKey" "OptionalFieldKey" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "center_optional_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "role" "UserRole" NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "displayName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "learnerCode" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "ageBand" "AgeBand" NOT NULL,
    "pinHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learner_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_optional_genders" (
    "learnerId" UUID NOT NULL,
    "gender" "Gender" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learner_optional_genders_pkey" PRIMARY KEY ("learnerId")
);

-- CreateTable
CREATE TABLE "learner_optional_contacts" (
    "learnerId" UUID NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learner_optional_contacts_pkey" PRIMARY KEY ("learnerId")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "registeredById" UUID,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "academicYear" INTEGER NOT NULL,
    "semester" "Semester" NOT NULL,
    "summary" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "learnerId" UUID NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrolledOn" DATE NOT NULL,
    "withdrawnOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section_teachers" (
    "id" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "section_teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "sectionId" UUID,
    "createdById" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "resourceType" "ResourceType" NOT NULL,
    "externalUrl" TEXT,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "byteSize" INTEGER,
    "checksumSha256" TEXT,
    "bodyText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_sessions" (
    "id" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "deliveryMode" "DeliveryMode" NOT NULL,
    "meetingUrl" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "linkedResourceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "learnerId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "reasonCode" "AbsenceReasonCode",
    "deviceId" UUID NOT NULL,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdOffline" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "AssignmentKind" NOT NULL,
    "dueAt" TIMESTAMP(3),
    "maxPoints" DECIMAL(6,2) NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_entries" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "learnerId" UUID NOT NULL,
    "points" DECIMAL(6,2) NOT NULL,
    "academicNote" VARCHAR(500),
    "recordedById" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "versionVector" JSONB NOT NULL,
    "deviceRecordedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdOffline" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grade_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_entry_versions" (
    "id" UUID NOT NULL,
    "gradeEntryId" UUID NOT NULL,
    "points" DECIMAL(6,2) NOT NULL,
    "academicNote" VARCHAR(500),
    "recordedById" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "versionVector" JSONB NOT NULL,
    "deviceRecordedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdOffline" BOOLEAN NOT NULL,
    "preservedFromConflict" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_entry_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "clientSubmissionId" TEXT NOT NULL,
    "assignmentId" UUID NOT NULL,
    "learnerId" UUID NOT NULL,
    "submittedById" UUID NOT NULL,
    "uploadState" "UploadState" NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "checksumSha256" VARCHAR(64) NOT NULL,
    "storageKey" TEXT NOT NULL,
    "deviceId" UUID NOT NULL,
    "createdOffline" BOOLEAN NOT NULL,
    "queuedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_upload_queue" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "state" "FileQueueState" NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" "FileErrorCode",
    "queuedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_upload_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_progress" (
    "id" UUID NOT NULL,
    "learnerId" UUID NOT NULL,
    "classSessionId" UUID NOT NULL,
    "status" "LessonStatus" NOT NULL,
    "completedAt" TIMESTAMP(3),
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_notes" (
    "id" UUID NOT NULL,
    "learnerId" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "skillGaps" "SkillGap"[],
    "customSkillLabel" VARCHAR(80),
    "deviceId" UUID NOT NULL,
    "versionVector" JSONB NOT NULL,
    "deviceRecordedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdOffline" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "progress_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_note_versions" (
    "id" UUID NOT NULL,
    "progressNoteId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "skillGaps" "SkillGap"[],
    "customSkillLabel" VARCHAR(80),
    "deviceId" UUID NOT NULL,
    "versionVector" JSONB NOT NULL,
    "deviceRecordedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdOffline" BOOLEAN NOT NULL,
    "preservedFromConflict" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progress_note_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handoff_reports" (
    "id" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "outgoingTeacherId" UUID NOT NULL,
    "incomingTeacherId" UUID,
    "assignedToId" UUID NOT NULL,
    "reason" "HandoffReason" NOT NULL,
    "status" "HandoffStatus" NOT NULL DEFAULT 'READY',
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "handoff_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transition_profiles" (
    "id" UUID NOT NULL,
    "handoffReportId" UUID NOT NULL,
    "learnerId" UUID NOT NULL,
    "attendanceRate" DECIMAL(5,2) NOT NULL,
    "unexcusedAbsenceCount" INTEGER NOT NULL,
    "gradeTrend" "TrendLabel" NOT NULL,
    "lessonsCompleted" INTEGER NOT NULL,
    "lessonsTotal" INTEGER NOT NULL,
    "skillGaps" "SkillGap"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transition_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transition_profile_notes" (
    "transitionProfileId" UUID NOT NULL,
    "progressNoteId" UUID NOT NULL,

    CONSTRAINT "transition_profile_notes_pkey" PRIMARY KEY ("transitionProfileId","progressNoteId")
);

-- CreateTable
CREATE TABLE "risk_flags" (
    "id" UUID NOT NULL,
    "learnerId" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "score" DECIMAL(5,2),
    "level" "RiskLevel" NOT NULL,
    "reasonCodes" "RiskReasonCode"[],
    "checkInSuggested" BOOLEAN NOT NULL DEFAULT false,
    "indicatorSnapshot" JSONB NOT NULL,
    "status" "RiskFlagStatus" NOT NULL,
    "dismissReason" "RiskDismissReason",
    "computedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "actorId" UUID,
    "action" "AuditAction" NOT NULL,
    "entityType" "AuditEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "deviceId" UUID,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_conflicts" (
    "id" UUID NOT NULL,
    "entityType" "SyncEntityType" NOT NULL,
    "state" "ConflictState" NOT NULL DEFAULT 'OPEN',
    "resolution" "ConflictResolution",
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "gradeEntryId" UUID,
    "gradeVersionAId" UUID,
    "gradeVersionBId" UUID,
    "shownGradeVersionId" UUID,
    "progressNoteId" UUID,
    "noteVersionAId" UUID,
    "noteVersionBId" UUID,
    "shownNoteVersionId" UUID,

    CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "json_sync_batches" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "compressedByteSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "json_sync_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "json_sync_items" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "entityType" "JsonSyncEntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "clientMutationId" TEXT NOT NULL,
    "status" "JsonSyncItemStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "json_sync_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "centers_code_key" ON "centers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "center_optional_fields_centerId_fieldKey_key" ON "center_optional_fields"("centerId", "fieldKey");

-- CreateIndex
CREATE INDEX "users_centerId_role_active_idx" ON "users"("centerId", "role", "active");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "learner_profiles_userId_key" ON "learner_profiles"("userId");

-- CreateIndex
CREATE INDEX "learner_profiles_centerId_ageBand_idx" ON "learner_profiles"("centerId", "ageBand");

-- CreateIndex
CREATE UNIQUE INDEX "learner_profiles_centerId_learnerCode_key" ON "learner_profiles"("centerId", "learnerCode");

-- CreateIndex
CREATE INDEX "devices_centerId_idx" ON "devices"("centerId");

-- CreateIndex
CREATE INDEX "courses_centerId_academicYear_semester_idx" ON "courses"("centerId", "academicYear", "semester");

-- CreateIndex
CREATE UNIQUE INDEX "courses_centerId_code_academicYear_semester_key" ON "courses"("centerId", "code", "academicYear", "semester");

-- CreateIndex
CREATE UNIQUE INDEX "sections_courseId_name_key" ON "sections"("courseId", "name");

-- CreateIndex
CREATE INDEX "enrollments_learnerId_status_idx" ON "enrollments"("learnerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_sectionId_learnerId_key" ON "enrollments"("sectionId", "learnerId");

-- CreateIndex
CREATE INDEX "section_teachers_teacherId_endsOn_idx" ON "section_teachers"("teacherId", "endsOn");

-- CreateIndex
CREATE INDEX "section_teachers_sectionId_endsOn_idx" ON "section_teachers"("sectionId", "endsOn");

-- CreateIndex
CREATE UNIQUE INDEX "section_teachers_sectionId_teacherId_startsOn_key" ON "section_teachers"("sectionId", "teacherId", "startsOn");

-- CreateIndex
CREATE INDEX "resources_courseId_idx" ON "resources"("courseId");

-- CreateIndex
CREATE INDEX "resources_sectionId_idx" ON "resources"("sectionId");

-- CreateIndex
CREATE INDEX "class_sessions_sectionId_startsAt_idx" ON "class_sessions"("sectionId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_clientEventId_key" ON "attendance_records"("clientEventId");

-- CreateIndex
CREATE INDEX "attendance_records_sessionId_learnerId_idx" ON "attendance_records"("sessionId", "learnerId");

-- CreateIndex
CREATE INDEX "attendance_records_learnerId_syncedAt_idx" ON "attendance_records"("learnerId", "syncedAt");

-- CreateIndex
CREATE INDEX "attendance_records_deviceId_syncedAt_idx" ON "attendance_records"("deviceId", "syncedAt");

-- CreateIndex
CREATE INDEX "assignments_sectionId_dueAt_idx" ON "assignments"("sectionId", "dueAt");

-- CreateIndex
CREATE INDEX "grade_entries_learnerId_idx" ON "grade_entries"("learnerId");

-- CreateIndex
CREATE INDEX "grade_entries_deviceId_idx" ON "grade_entries"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "grade_entries_assignmentId_learnerId_key" ON "grade_entries"("assignmentId", "learnerId");

-- CreateIndex
CREATE INDEX "grade_entry_versions_gradeEntryId_syncedAt_idx" ON "grade_entry_versions"("gradeEntryId", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_clientSubmissionId_key" ON "submissions"("clientSubmissionId");

-- CreateIndex
CREATE INDEX "submissions_assignmentId_learnerId_idx" ON "submissions"("assignmentId", "learnerId");

-- CreateIndex
CREATE INDEX "submissions_uploadState_queuedAt_idx" ON "submissions"("uploadState", "queuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "file_upload_queue_submissionId_key" ON "file_upload_queue"("submissionId");

-- CreateIndex
CREATE INDEX "file_upload_queue_state_queuedAt_idx" ON "file_upload_queue"("state", "queuedAt");

-- CreateIndex
CREATE INDEX "lesson_progress_classSessionId_idx" ON "lesson_progress"("classSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_progress_learnerId_classSessionId_key" ON "lesson_progress"("learnerId", "classSessionId");

-- CreateIndex
CREATE INDEX "progress_notes_learnerId_sectionId_idx" ON "progress_notes"("learnerId", "sectionId");

-- CreateIndex
CREATE INDEX "progress_notes_sectionId_idx" ON "progress_notes"("sectionId");

-- CreateIndex
CREATE INDEX "progress_notes_deviceId_idx" ON "progress_notes"("deviceId");

-- CreateIndex
CREATE INDEX "progress_note_versions_progressNoteId_syncedAt_idx" ON "progress_note_versions"("progressNoteId", "syncedAt");

-- CreateIndex
CREATE INDEX "handoff_reports_assignedToId_status_idx" ON "handoff_reports"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "handoff_reports_sectionId_generatedAt_idx" ON "handoff_reports"("sectionId", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "transition_profiles_handoffReportId_learnerId_key" ON "transition_profiles"("handoffReportId", "learnerId");

-- CreateIndex
CREATE INDEX "risk_flags_centerId_status_level_idx" ON "risk_flags"("centerId", "status", "level");

-- CreateIndex
CREATE INDEX "risk_flags_learnerId_computedAt_idx" ON "risk_flags"("learnerId", "computedAt");

-- CreateIndex
CREATE INDEX "audit_logs_centerId_at_idx" ON "audit_logs"("centerId", "at");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "sync_conflicts_gradeVersionAId_key" ON "sync_conflicts"("gradeVersionAId");

-- CreateIndex
CREATE UNIQUE INDEX "sync_conflicts_gradeVersionBId_key" ON "sync_conflicts"("gradeVersionBId");

-- CreateIndex
CREATE UNIQUE INDEX "sync_conflicts_noteVersionAId_key" ON "sync_conflicts"("noteVersionAId");

-- CreateIndex
CREATE UNIQUE INDEX "sync_conflicts_noteVersionBId_key" ON "sync_conflicts"("noteVersionBId");

-- CreateIndex
CREATE INDEX "sync_conflicts_state_entityType_idx" ON "sync_conflicts"("state", "entityType");

-- CreateIndex
CREATE INDEX "sync_conflicts_gradeEntryId_idx" ON "sync_conflicts"("gradeEntryId");

-- CreateIndex
CREATE INDEX "sync_conflicts_progressNoteId_idx" ON "sync_conflicts"("progressNoteId");

-- CreateIndex
CREATE INDEX "json_sync_batches_deviceId_receivedAt_idx" ON "json_sync_batches"("deviceId", "receivedAt");

-- CreateIndex
CREATE INDEX "json_sync_batches_centerId_receivedAt_idx" ON "json_sync_batches"("centerId", "receivedAt");

-- CreateIndex
CREATE INDEX "json_sync_items_batchId_idx" ON "json_sync_items"("batchId");

-- CreateIndex
CREATE INDEX "json_sync_items_entityType_entityId_idx" ON "json_sync_items"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "json_sync_items_deviceId_clientMutationId_key" ON "json_sync_items"("deviceId", "clientMutationId");

-- AddForeignKey
ALTER TABLE "center_optional_fields" ADD CONSTRAINT "center_optional_fields_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_profiles" ADD CONSTRAINT "learner_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_profiles" ADD CONSTRAINT "learner_profiles_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_optional_genders" ADD CONSTRAINT "learner_optional_genders_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_optional_contacts" ADD CONSTRAINT "learner_optional_contacts_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_teachers" ADD CONSTRAINT "section_teachers_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_teachers" ADD CONSTRAINT "section_teachers_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_linkedResourceId_fkey" FOREIGN KEY ("linkedResourceId") REFERENCES "resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "class_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_entries" ADD CONSTRAINT "grade_entries_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_entries" ADD CONSTRAINT "grade_entries_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_entries" ADD CONSTRAINT "grade_entries_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_entries" ADD CONSTRAINT "grade_entries_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_entry_versions" ADD CONSTRAINT "grade_entry_versions_gradeEntryId_fkey" FOREIGN KEY ("gradeEntryId") REFERENCES "grade_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_entry_versions" ADD CONSTRAINT "grade_entry_versions_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_entry_versions" ADD CONSTRAINT "grade_entry_versions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_upload_queue" ADD CONSTRAINT "file_upload_queue_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_classSessionId_fkey" FOREIGN KEY ("classSessionId") REFERENCES "class_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_notes" ADD CONSTRAINT "progress_notes_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_notes" ADD CONSTRAINT "progress_notes_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_notes" ADD CONSTRAINT "progress_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_notes" ADD CONSTRAINT "progress_notes_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_note_versions" ADD CONSTRAINT "progress_note_versions_progressNoteId_fkey" FOREIGN KEY ("progressNoteId") REFERENCES "progress_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_note_versions" ADD CONSTRAINT "progress_note_versions_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_note_versions" ADD CONSTRAINT "progress_note_versions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_reports" ADD CONSTRAINT "handoff_reports_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_reports" ADD CONSTRAINT "handoff_reports_outgoingTeacherId_fkey" FOREIGN KEY ("outgoingTeacherId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_reports" ADD CONSTRAINT "handoff_reports_incomingTeacherId_fkey" FOREIGN KEY ("incomingTeacherId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_reports" ADD CONSTRAINT "handoff_reports_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition_profiles" ADD CONSTRAINT "transition_profiles_handoffReportId_fkey" FOREIGN KEY ("handoffReportId") REFERENCES "handoff_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition_profiles" ADD CONSTRAINT "transition_profiles_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition_profile_notes" ADD CONSTRAINT "transition_profile_notes_transitionProfileId_fkey" FOREIGN KEY ("transitionProfileId") REFERENCES "transition_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition_profile_notes" ADD CONSTRAINT "transition_profile_notes_progressNoteId_fkey" FOREIGN KEY ("progressNoteId") REFERENCES "progress_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "learner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_gradeEntryId_fkey" FOREIGN KEY ("gradeEntryId") REFERENCES "grade_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_gradeVersionAId_fkey" FOREIGN KEY ("gradeVersionAId") REFERENCES "grade_entry_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_gradeVersionBId_fkey" FOREIGN KEY ("gradeVersionBId") REFERENCES "grade_entry_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_shownGradeVersionId_fkey" FOREIGN KEY ("shownGradeVersionId") REFERENCES "grade_entry_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_progressNoteId_fkey" FOREIGN KEY ("progressNoteId") REFERENCES "progress_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_noteVersionAId_fkey" FOREIGN KEY ("noteVersionAId") REFERENCES "progress_note_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_noteVersionBId_fkey" FOREIGN KEY ("noteVersionBId") REFERENCES "progress_note_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_shownNoteVersionId_fkey" FOREIGN KEY ("shownNoteVersionId") REFERENCES "progress_note_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "json_sync_batches" ADD CONSTRAINT "json_sync_batches_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "json_sync_batches" ADD CONSTRAINT "json_sync_batches_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "json_sync_items" ADD CONSTRAINT "json_sync_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "json_sync_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "json_sync_items" ADD CONSTRAINT "json_sync_items_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rules Prisma cannot express. They protect privacy boundaries and stop a
-- phone retry, or a mistaken update, from destroying attendance or a grade.

ALTER TABLE "centers" ADD CONSTRAINT "centers_risk_thresholds_check" CHECK (
  "watchRiskThreshold" >= 0
  AND "watchRiskThreshold" <= 100
  AND "highRiskThreshold" >= 0
  AND "highRiskThreshold" <= 100
  AND "watchRiskThreshold" < "highRiskThreshold"
  AND "smallGroupSuppressionMin" >= 1
);

ALTER TABLE "users" ADD CONSTRAINT "users_sign_in_check" CHECK (
  ("role" = 'STUDENT' AND "email" IS NULL AND "passwordHash" IS NULL)
  OR
  ("role" <> 'STUDENT' AND "email" IS NOT NULL AND "passwordHash" IS NOT NULL)
);

ALTER TABLE "users" ADD CONSTRAINT "users_active_check" CHECK (
  ("active" = true AND "deactivatedAt" IS NULL)
  OR
  ("active" = false AND "deactivatedAt" IS NOT NULL)
);

ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_withdrawn_check" CHECK (
  ("status" = 'WITHDRAWN' AND "withdrawnOn" IS NOT NULL)
  OR
  ("status" <> 'WITHDRAWN' AND "withdrawnOn" IS NULL)
);

ALTER TABLE "section_teachers" ADD CONSTRAINT "section_teachers_dates_check" CHECK (
  "endsOn" IS NULL OR "endsOn" >= "startsOn"
);

CREATE UNIQUE INDEX "section_teachers_one_open_assignment"
ON "section_teachers" ("sectionId", "teacherId")
WHERE "endsOn" IS NULL;

ALTER TABLE "resources" ADD CONSTRAINT "resources_payload_check" CHECK (
  (
    "resourceType" IN ('TEXTBOOK_LINK', 'VIDEO_LINK', 'WEB_LINK')
    AND "externalUrl" IS NOT NULL
    AND "storageKey" IS NULL
    AND "bodyText" IS NULL
  )
  OR
  (
    "resourceType" IN ('PDF', 'AUDIO')
    AND "storageKey" IS NOT NULL
    AND "externalUrl" IS NULL
    AND "bodyText" IS NULL
    AND "byteSize" IS NOT NULL
    AND "byteSize" > 0
    AND "checksumSha256" IS NOT NULL
  )
  OR
  (
    "resourceType" = 'TEXT'
    AND "bodyText" IS NOT NULL
    AND "externalUrl" IS NULL
    AND "storageKey" IS NULL
  )
);

ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_time_check" CHECK ("endsAt" > "startsAt");

ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_meeting_url_check" CHECK (
  "meetingUrl" IS NULL OR "deliveryMode" = 'LIVE_ONLINE'
);

ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_reason_check" CHECK (
  ("status" = 'PRESENT' AND "reasonCode" IS NULL)
  OR
  ("status" IN ('ABSENT', 'LATE', 'EXCUSED'))
);

ALTER TABLE "submissions" ADD CONSTRAINT "submissions_file_check" CHECK (
  "byteSize" > 0
  AND char_length("checksumSha256") = 64
  AND "checksumSha256" ~ '^[a-f0-9]{64}$'
  AND "storageKey" NOT ILIKE 'http%'
  AND position('://' in "storageKey") = 0
);

ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_completed_check" CHECK (
  ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL)
  OR
  ("status" <> 'COMPLETED' AND "completedAt" IS NULL)
);

ALTER TABLE "progress_notes" ADD CONSTRAINT "progress_notes_custom_skill_check" CHECK (
  (
    "customSkillLabel" IS NULL
    AND NOT ('CUSTOM'::"SkillGap" = ANY("skillGaps"))
  )
  OR
  (
    "customSkillLabel" IS NOT NULL
    AND 'CUSTOM'::"SkillGap" = ANY("skillGaps")
  )
);

ALTER TABLE "progress_note_versions" ADD CONSTRAINT "progress_note_versions_custom_skill_check" CHECK (
  (
    "customSkillLabel" IS NULL
    AND NOT ('CUSTOM'::"SkillGap" = ANY("skillGaps"))
  )
  OR
  (
    "customSkillLabel" IS NOT NULL
    AND 'CUSTOM'::"SkillGap" = ANY("skillGaps")
  )
);

ALTER TABLE "handoff_reports" ADD CONSTRAINT "handoff_reports_ack_check" CHECK (
  ("status" = 'ACKNOWLEDGED' AND "acknowledgedAt" IS NOT NULL)
  OR
  ("status" = 'READY' AND "acknowledgedAt" IS NULL)
);

ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_score_check" CHECK (
  ("level" = 'INSUFFICIENT_DATA' AND "score" IS NULL)
  OR
  ("level" <> 'INSUFFICIENT_DATA' AND "score" IS NOT NULL AND "score" >= 0 AND "score" <= 100)
);

ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_status_check" CHECK (
  ("status" = 'DISMISSED' AND "dismissReason" IS NOT NULL AND "resolvedAt" IS NOT NULL)
  OR
  ("status" = 'CHECK_IN_DONE' AND "resolvedAt" IS NOT NULL AND "dismissReason" IS NULL)
  OR
  ("status" = 'OPEN' AND "resolvedAt" IS NULL AND "dismissReason" IS NULL)
);

ALTER TABLE "file_upload_queue" ADD CONSTRAINT "file_upload_queue_attempts_check" CHECK ("attemptCount" >= 0);

ALTER TABLE "json_sync_batches" ADD CONSTRAINT "json_sync_batches_size_check" CHECK (
  "itemCount" >= 0 AND "compressedByteSize" >= 0
);

ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_pair_check" CHECK (
  (
    "entityType" = 'GRADE_ENTRY'
    AND "gradeEntryId" IS NOT NULL
    AND "gradeVersionAId" IS NOT NULL
    AND "gradeVersionBId" IS NOT NULL
    AND "gradeVersionAId" <> "gradeVersionBId"
    AND "shownGradeVersionId" IS NOT NULL
    AND ("shownGradeVersionId" = "gradeVersionAId" OR "shownGradeVersionId" = "gradeVersionBId")
    AND "progressNoteId" IS NULL
    AND "noteVersionAId" IS NULL
    AND "noteVersionBId" IS NULL
    AND "shownNoteVersionId" IS NULL
  )
  OR
  (
    "entityType" = 'PROGRESS_NOTE'
    AND "progressNoteId" IS NOT NULL
    AND "noteVersionAId" IS NOT NULL
    AND "noteVersionBId" IS NOT NULL
    AND "noteVersionAId" <> "noteVersionBId"
    AND "shownNoteVersionId" IS NOT NULL
    AND ("shownNoteVersionId" = "noteVersionAId" OR "shownNoteVersionId" = "noteVersionBId")
    AND "gradeEntryId" IS NULL
    AND "gradeVersionAId" IS NULL
    AND "gradeVersionBId" IS NULL
    AND "shownGradeVersionId" IS NULL
  )
);

ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_resolution_check" CHECK (
  ("state" = 'OPEN' AND "resolution" IS NULL AND "resolvedAt" IS NULL AND "resolvedById" IS NULL)
  OR
  ("state" = 'RESOLVED' AND "resolution" IS NOT NULL AND "resolvedAt" IS NOT NULL)
);

CREATE FUNCTION reject_append_only_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.allow_demo_reset', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only and cannot be %', TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE TRIGGER "attendance_records_append_only"
BEFORE UPDATE OR DELETE ON "attendance_records"
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE TRIGGER "audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE TRIGGER "grade_entry_versions_append_only"
BEFORE UPDATE OR DELETE ON "grade_entry_versions"
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE TRIGGER "progress_note_versions_append_only"
BEFORE UPDATE OR DELETE ON "progress_note_versions"
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE FUNCTION learner_center_matches_user() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  account_center uuid;
  account_role "UserRole";
BEGIN
  SELECT "centerId", "role" INTO account_center, account_role
  FROM "users" WHERE "id" = NEW."userId";
  IF account_role IS DISTINCT FROM 'STUDENT' THEN
    RAISE EXCEPTION 'learner profile requires a student account';
  END IF;
  IF account_center IS DISTINCT FROM NEW."centerId" THEN
    RAISE EXCEPTION 'learner center must match the student account center';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "learner_profiles_center"
BEFORE INSERT OR UPDATE ON "learner_profiles"
FOR EACH ROW EXECUTE FUNCTION learner_center_matches_user();

CREATE FUNCTION accounts_match_profiles() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "users" AS u
    LEFT JOIN "learner_profiles" AS p ON p."userId" = u."id"
    WHERE u."role" = 'STUDENT' AND p."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'student account is missing a learner profile';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "learner_profiles" AS p
    JOIN "users" AS u ON u."id" = p."userId"
    WHERE u."role" <> 'STUDENT'
  ) THEN
    RAISE EXCEPTION 'only a student account can have a learner profile';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "users_profile_required"
AFTER INSERT OR UPDATE OR DELETE ON "users"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION accounts_match_profiles();

CREATE CONSTRAINT TRIGGER "learner_profiles_account_required"
AFTER INSERT OR UPDATE OR DELETE ON "learner_profiles"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION accounts_match_profiles();

CREATE FUNCTION optional_field_allowed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  required_field "OptionalFieldKey";
BEGIN
  IF TG_TABLE_NAME = 'learner_optional_genders' THEN
    required_field := 'GENDER';
  ELSE
    required_field := 'CONTACT_PHONE';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "learner_profiles" AS p
    JOIN "center_optional_fields" AS f ON f."centerId" = p."centerId"
    WHERE p."id" = NEW."learnerId"
      AND f."fieldKey" = required_field
      AND f."enabled" = true
  ) THEN
    RAISE EXCEPTION 'this center has not approved %', required_field;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "learner_optional_genders_allowed"
BEFORE INSERT OR UPDATE ON "learner_optional_genders"
FOR EACH ROW EXECUTE FUNCTION optional_field_allowed();

CREATE TRIGGER "learner_optional_contacts_allowed"
BEFORE INSERT OR UPDATE ON "learner_optional_contacts"
FOR EACH ROW EXECUTE FUNCTION optional_field_allowed();

CREATE FUNCTION resource_section_same_course() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."sectionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "sections" AS s
    WHERE s."id" = NEW."sectionId" AND s."courseId" = NEW."courseId"
  ) THEN
    RAISE EXCEPTION 'resource section must belong to the resource course';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "resources_section_course"
BEFORE INSERT OR UPDATE ON "resources"
FOR EACH ROW EXECUTE FUNCTION resource_section_same_course();

CREATE FUNCTION enrollment_same_center() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "learner_profiles" AS l
    JOIN "sections" AS s ON s."id" = NEW."sectionId"
    JOIN "courses" AS c ON c."id" = s."courseId"
    WHERE l."id" = NEW."learnerId" AND l."centerId" = c."centerId"
  ) THEN
    RAISE EXCEPTION 'learner and section must belong to the same center';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "enrollments_same_center"
BEFORE INSERT OR UPDATE ON "enrollments"
FOR EACH ROW EXECUTE FUNCTION enrollment_same_center();

CREATE FUNCTION section_teacher_same_center() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "users" AS u
    JOIN "sections" AS s ON s."id" = NEW."sectionId"
    JOIN "courses" AS c ON c."id" = s."courseId"
    WHERE u."id" = NEW."teacherId"
      AND u."role" = 'TEACHER'
      AND u."centerId" = c."centerId"
  ) THEN
    RAISE EXCEPTION 'section teacher must be a teacher at the same center';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "section_teachers_same_center"
BEFORE INSERT OR UPDATE ON "section_teachers"
FOR EACH ROW EXECUTE FUNCTION section_teacher_same_center();

CREATE FUNCTION attendance_matches_enrollment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "class_sessions" AS sess
    JOIN "enrollments" AS e ON e."sectionId" = sess."sectionId" AND e."learnerId" = NEW."learnerId"
    JOIN "learner_profiles" AS l ON l."id" = NEW."learnerId"
    JOIN "sections" AS s ON s."id" = sess."sectionId"
    JOIN "courses" AS c ON c."id" = s."courseId"
    JOIN "devices" AS d ON d."id" = NEW."deviceId"
    JOIN "users" AS recorder ON recorder."id" = NEW."recordedById"
    WHERE sess."id" = NEW."sessionId"
      AND l."centerId" = c."centerId"
      AND d."centerId" = c."centerId"
      AND recorder."centerId" = c."centerId"
      AND recorder."role" IN ('TEACHER', 'CENTER_DIRECTOR')
  ) THEN
    RAISE EXCEPTION 'attendance must be for an enrolled learner, recorded by staff at the same center';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "attendance_records_enrollment"
BEFORE INSERT OR UPDATE ON "attendance_records"
FOR EACH ROW EXECUTE FUNCTION attendance_matches_enrollment();

CREATE FUNCTION grade_entry_is_valid() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  max_points numeric;
BEGIN
  SELECT a."maxPoints" INTO max_points
  FROM "assignments" AS a
  WHERE a."id" = NEW."assignmentId";

  IF max_points IS NULL OR NEW."points" < 0 OR NEW."points" > max_points THEN
    RAISE EXCEPTION 'grade points are outside the assignment maximum';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "assignments" AS a
    JOIN "enrollments" AS e ON e."sectionId" = a."sectionId" AND e."learnerId" = NEW."learnerId"
    JOIN "learner_profiles" AS l ON l."id" = NEW."learnerId"
    JOIN "devices" AS d ON d."id" = NEW."deviceId"
    JOIN "users" AS recorder ON recorder."id" = NEW."recordedById"
    WHERE a."id" = NEW."assignmentId"
      AND d."centerId" = l."centerId"
      AND recorder."centerId" = l."centerId"
      AND recorder."role" IN ('TEACHER', 'CENTER_DIRECTOR')
  ) THEN
    RAISE EXCEPTION 'grade must be for an enrolled learner and recorded by staff at that center';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "grade_entries_valid"
BEFORE INSERT OR UPDATE ON "grade_entries"
FOR EACH ROW EXECUTE FUNCTION grade_entry_is_valid();

CREATE FUNCTION grade_version_points_valid() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  max_points numeric;
BEGIN
  SELECT a."maxPoints" INTO max_points
  FROM "grade_entries" AS g
  JOIN "assignments" AS a ON a."id" = g."assignmentId"
  WHERE g."id" = NEW."gradeEntryId";

  IF max_points IS NULL OR NEW."points" < 0 OR NEW."points" > max_points THEN
    RAISE EXCEPTION 'grade points are outside the assignment maximum';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "grade_entry_versions_points"
BEFORE INSERT OR UPDATE ON "grade_entry_versions"
FOR EACH ROW EXECUTE FUNCTION grade_version_points_valid();

CREATE FUNCTION progress_note_is_valid() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "enrollments" AS e
    JOIN "learner_profiles" AS l ON l."id" = NEW."learnerId"
    JOIN "users" AS author ON author."id" = NEW."authorId"
    JOIN "devices" AS d ON d."id" = NEW."deviceId"
    WHERE e."learnerId" = NEW."learnerId"
      AND e."sectionId" = NEW."sectionId"
      AND author."centerId" = l."centerId"
      AND d."centerId" = l."centerId"
      AND author."role" IN ('TEACHER', 'CENTER_DIRECTOR')
  ) THEN
    RAISE EXCEPTION 'progress note must be for an enrolled learner and written by staff at that center';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "progress_notes_valid"
BEFORE INSERT OR UPDATE ON "progress_notes"
FOR EACH ROW EXECUTE FUNCTION progress_note_is_valid();

CREATE FUNCTION sync_conflict_versions_match_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."entityType" = 'GRADE_ENTRY' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "grade_entry_versions" AS v
      WHERE v."id" = NEW."gradeVersionAId" AND v."gradeEntryId" = NEW."gradeEntryId"
    ) OR NOT EXISTS (
      SELECT 1 FROM "grade_entry_versions" AS v
      WHERE v."id" = NEW."gradeVersionBId" AND v."gradeEntryId" = NEW."gradeEntryId"
    ) THEN
      RAISE EXCEPTION 'grade conflict versions must belong to the same grade';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM "progress_note_versions" AS v
      WHERE v."id" = NEW."noteVersionAId" AND v."progressNoteId" = NEW."progressNoteId"
    ) OR NOT EXISTS (
      SELECT 1 FROM "progress_note_versions" AS v
      WHERE v."id" = NEW."noteVersionBId" AND v."progressNoteId" = NEW."progressNoteId"
    ) THEN
      RAISE EXCEPTION 'note conflict versions must belong to the same note';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "sync_conflicts_same_record"
BEFORE INSERT OR UPDATE ON "sync_conflicts"
FOR EACH ROW EXECUTE FUNCTION sync_conflict_versions_match_parent();
