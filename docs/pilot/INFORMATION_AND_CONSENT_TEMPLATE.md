# Information and consent sheet

**This is a template, not legal advice.** It is not proof that Open LMS Refuge meets any law. [Centre name] must read it, change it for its own situation, and check it against the rules that apply to the centre before anyone uses the app with real learners. Delete this warning only after that review.

Contact for questions: [Contact person], [Contact details].

## What this app is

Open LMS Refuge is a prototype learning app. It was built for community learning centres that teach refugee learners, especially centres that share phones and do not always have reliable internet.

[Centre name] is considering a short trial so teachers and learners can see whether it helps with attendance, class links, course materials, grades, and progress notes.

This trial has not been approved by any named organisation in this template. The centre fills in its own decision.

## What people may use it for

Teachers may sign in, open their sections, mark attendance, send saved attendance, open course materials, record grades and progress notes, and read a handoff report that was assigned to them.

Learners may sign in with a centre code, a learner code, and a PIN, see today's classes, open materials, and submit a homework file when file storage is set up.

The app does not have a registration form. The centre creates accounts outside the normal screens, or uses the synthetic demo data only for a practice run.

## What the app stores

For a learner, the profile stores a learner code, a nickname, an age band, and a PIN. The PIN is stored as a hash, not as the four digits themselves.

For staff, it stores an email, a display name, and a password hash.

It also stores attendance, a short list of absence reasons, grades, optional grade comments, homework files, progress notes, skill gaps, the timetable, course materials, check-in suggestions, handoff reports, and an audit log of who viewed or changed certain records.

The database can store an optional gender and an optional phone number. The current screens do not ask for them.

## What it does not ask for in a dedicated field

The profile form does not ask for legal status, a home address, or an exact date of birth. Age is stored as a band, such as 12–14.

A person can still type those details into a note or a comment. A photo or PDF can show them. The app does not scan notes or files.

Please do not put legal status, identity-document numbers, home addresses, exact birth dates, or sensitive family stories into notes, comments, or homework files.

## Where information is kept

The centre's records are stored in the centre's database on the server [Centre name] chooses. This template does not name a hosting company, because this project does not yet have a finished production deployment.

A phone also keeps copies in the browser so attendance can be marked offline. That phone storage is **not encrypted**. Signing out locks the screen inside the app. It does not encrypt the copies, and it does not delete unsent attendance, grades, notes, or homework files.

## Risk scores

If [Centre name] turns on the scoring service, a director can start a check. The service receives the learner's real learner code, attendance dates and statuses, assignment counts, grade points, and the centre's score thresholds. It does not receive names or note text.

The learner code is not anonymous. The centre can match it back to the learner. If the service is not configured, no score is created.

## Homework files

Homework files are uploaded to Cloudflare R2 only when the centre has configured that private storage. The file itself may contain personal information. If storage is not configured, the file stays on the phone and the app says storage is unavailable.

## Reports

A director or administrator can download a CSV or PDF. The usual report contains counts for the centre, not a list of names. Counts smaller than the centre's minimum, usually 5, are shown as `<5`.

A second kind of report can list learners as codes called pseudonyms. That report is still sensitive. It is not anonymous. It is available only when a funder requirement is already stored. This version has no screen for creating that requirement, and it does not send reports to a funder by itself.

## Known limits

- Phone storage is not encrypted.
- Notes and uploaded files can contain information the forms do not ask for.
- There is no button that erases a learner's history.
- Switching an account off keeps the old records.
- A small class can still be recognisable in a report even when small counts are hidden.
- This sheet does not promise anonymity, complete security, or legal compliance.

## Questions and concerns

Ask [Contact person] at [Contact details]. You can ask what is stored, who can see it, and how to stop using the app. [Centre name] should write here what it will do when someone raises a concern:

[What the centre will do]

[Centre name] should also write its own retention period here, if it has one. The software does not set one:

[Retention period, or "not decided"]

## Acknowledgement

[Centre name] should replace this section with the wording it decides to use. Do not treat the lines below as a finished consent form.

I have had this sheet explained to me. I could ask questions. I understand that this is a trial of a prototype, that notes and files can contain sensitive information if someone types or photographs it, and that copies on a shared phone are not encrypted.

Name (optional): _______________________________

Role (teacher, learner, or parent or guardian): _______________________________

Date: _______________________________

Signature or other mark the centre accepts: _______________________________

If the learner is a child, [Centre name] must decide who may acknowledge this sheet and must not copy this template unchanged.
