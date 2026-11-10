-- Adds the hybrid assignment kind used by LMS-4.
-- PAPER, DIGITAL, and IN_CLASS_EXAM stay. No rows are rewritten or deleted.
-- BOTH means a paper mark now and a digital file later. It is not DIGITAL.
ALTER TYPE "AssignmentKind" ADD VALUE 'BOTH';
