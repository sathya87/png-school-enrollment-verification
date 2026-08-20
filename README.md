# School Enrollment Verification & Anti-Fraud System (Proof of Concept)

A proof-of-concept web application for Papua New Guinea's National Department of
Education (NDoE) to catch inflated school enrollment figures **before** Tuition
Fee Free (TFF) funding is disbursed.

**Live demo:** https://png-school-enrollment-verification.onrender.com
(free-tier hosting — the first request after idle may take ~30-60s to wake up;
demo login: any username/password creates that account on first sign-in)

**Context:** In 2026, PNG's Education Minister revealed that roughly 2,000
schools deliberately inflated or falsified enrollment figures to claim more TFF
funding than they were entitled to. This system demonstrates automated,
rule-based anomaly detection on enrollment submissions, plus a review workflow
for ministry staff to confirm fraud and see the funding gap before money moves.

## What's real vs. what's simplified for this POC

### Real

- **The database.** A genuine SQLite database file (`data/enrollment.db`) using
  Node's built-in `node:sqlite` module — no mocks, no in-memory data. Stop the
  server, restart it, and every school, submission, and anomaly is still there.
- **The anomaly detection logic.** Four concrete, auditable rules run
  automatically on every submission (see below) and are backed by real SQL
  queries against submission history and the actual student roster, not
  canned/hardcoded responses.
- **Student, teacher, and attendance records.** Real per-student rosters
  (with enrollment status and parent/guardian contact info), a staff
  directory, and daily attendance — not mocked data. Two schools
  (Gordons Primary and Kerowagi Primary) are seeded with full rosters and
  five days of attendance so the roster-mismatch check and Reports tab have
  something real to show immediately; the other eight schools only have
  aggregate enrollment figures, mirroring how partial digitization actually
  looks in the field.
- **The parent SMS notifications.** Daily attendance status, homework, and
  per-student report messages are composed from real data (today's
  attendance record, the actual homework row, the actual attendance rate)
  and logged to `sms_log` with a real send attempt per message — see the SMS
  note below for what "real" means here.
- **The review workflow.** Marking an anomaly "Confirmed fraud" actually writes
  a `verified_count` onto the underlying submission, and the disbursement
  calculator recalculates the funding gap from that verified figure — it isn't
  a cosmetic status change.
- **Sessions and password hashing.** Passwords are salted and hashed
  (PBKDF2-SHA256, 100,000 iterations) before storage, and sessions are random
  opaque tokens stored server-side, not JWTs with client-trusted claims.

### Simplified (clearly a POC, not production)

- **Login is demo-grade.** The **first sign-in with any username creates that
  account** using whatever password you typed — there is no registration
  approval, email verification, password reset, or account lockout. This is
  intentional for a fast demo and is disclosed on the login screen itself. A
  real deployment would integrate with NDoE's actual staff directory /
  identity provider and role-based access (district manager vs. ministry
  reviewer are not currently separate roles — any logged-in user can do both).
- **Anomaly detection is statistics-only.** The three rules below compare a
  submission against *its own reported history* and a capacity heuristic.
  Real-world fraud detection would also cross-reference:
  - Independent attendance registers / physical headcounts and school
    inspections,
  - National ID or biometric-linked student rolls (to catch phantom
    students, not just implausible *totals*),
  - Cross-checks against census and prior audit findings,
  - Multi-year trend analysis and peer-school comparisons within the same
    district, not just a single prior-year figure.

  A single year-over-year or capacity check can be gamed by inflating gradually
  or fabricating classroom counts — this POC intentionally keeps the rules
  simple and transparent so they're easy to explain to non-technical
  stakeholders, not because they're sufficient on their own.
- **TFF rates are illustrative.** The per-student Kina rates in
  [`src/disbursement.js`](src/disbursement.js) are placeholder figures for
  demo purposes only — they are **not** NDoE's official published TFF rates,
  which vary by school type/grade and are set by policy each year.
- **No file uploads / supporting evidence.** A real system would let district
  managers attach enrollment registers, photos, or inspection reports to a
  submission for reviewers to check against.
- **SMS is simulated unless Twilio is configured.** Set
  `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` as
  environment variables to send real text messages; otherwise every send is
  logged to the console and to `sms_log` with status `simulated` — no
  external call, no cost, no real telco account needed to demo this. This
  matches the same "simulated until configured" convention used for SMS in
  the sibling PNG apps in this workspace (see [`src/sms.js`](src/sms.js)).
- **Attendance history is short.** The seed data only covers the last 5
  days for the two rosters with student data — enough to demonstrate the
  attendance summary report and daily-status SMS, not a full term.
- **Roster digitization is partial by design.** Only 2 of the 10 seeded
  schools have a named student roster on file; the roster-mismatch anomaly
  check and Reports tab only evaluate schools with roster data, which is
  realistic — most PNG schools would not have a digitized roster on day one
  of a system like this.

## Data model

- **Schools** — name, province, district, type (elementary/primary/secondary),
  classroom count (used for the capacity check).
- **Enrollment submissions** — school, year, term, reported student count,
  submitted-by, submitted date, and an optional verified count set by a
  reviewer.
- **Anomalies** — a reference to the flagged submission, the reason, severity
  (low/medium/high), and status (open / reviewed-cleared / confirmed-fraud).
- **Students** — school, name, grade, enrollment status
  (active/transferred/withdrawn), parent/guardian name and phone.
- **Teachers** — school, name, subject, employment status
  (active/on_leave/terminated).
- **Syllabus entries** — school type, grade, subject, term, topic.
- **Attendance records** — student, date, status (present/absent/late),
  recorded-by (one row per student per day).
- **Homework assignments** — school, grade, subject, description, due date,
  created-by.
- **SMS log** — student, phone, message type (daily_status/homework/report),
  body, status (sent/simulated/failed), sent-by, sent-at.

## Anomaly detection rules

Run automatically, in [`src/anomalyDetection.js`](src/anomalyDetection.js),
the instant a submission is saved:

1. **Year-over-year jump** — reported count is more than 20% higher than the
   same school's figure for the same term the prior year (severity: medium
   above 20%, high above 50%).
2. **Capacity ceiling** — reported count exceeds `classrooms × 40` students,
   a rough per-classroom capacity heuristic for PNG schools.
3. **Roster mismatch** — reported count is more than 15% higher than the
   school's actual named-student roster, when that school has roster data on
   file (severity: medium above 15%, high above 40%). This is the closest
   thing this POC has to an independent cross-check, catching "phantom
   student" inflation that a pure year-over-year comparison would miss —
   see the seeded Kerowagi Primary School case (220 real students, 340
   reported) in the Flagged anomalies and Reports tabs.
4. **Duplicate submission** — the same school already has another submission
   for the same year and term (possible resubmission fraud).

## Running locally

Requires **Node.js 22.5+** (this POC uses the built-in `node:sqlite` module —
no native build step, no `better-sqlite3` dependency).

```bash
npm install
npm start
```

Then open **http://localhost:4000**. On first run, the database is created and
seeded automatically with 10 sample PNG schools across several provinces and a
realistic mix of clean and flagged submissions (see
[`src/seed.js`](src/seed.js)) so the demo has data immediately.

To wipe and reseed the demo data at any point:

```bash
npm run seed
```

**Logging in:** type any username and password on the login screen — that
combination becomes your account. Use the same username/password again next
time to sign back in.

## API reference

All endpoints except `/api/login` require `Authorization: Bearer <token>`
(the token returned by login).

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/login` | POST | `{ username, password }` → creates the account on first use, or signs in |
| `/api/schools` | GET | List schools (filter with `?province=` / `?schoolType=`) |
| `/api/schools` | POST | Add a school |
| `/api/enrollments` | GET | List submissions (filter with `?schoolId=` / `?year=` / `?term=` / `?province=`) |
| `/api/enrollments` | POST | `{ schoolId, year, term, reportedCount }` → submits a figure and runs anomaly detection |
| `/api/anomalies` | GET | List flagged anomalies (filter with `?severity=` / `?status=` / `?province=`) |
| `/api/anomalies/:id/resolve` | POST | `{ status: "reviewed_cleared" \| "confirmed_fraud", notes?, verifiedCount? }` |
| `/api/disbursement/:schoolId` | GET | Calculates claimed vs. verified TFF amount and the funding gap |
| `/api/students` | GET | List students (filter with `?schoolId=` / `?grade=` / `?enrollmentStatus=`) |
| `/api/students` | POST | `{ schoolId, name, grade, parentName?, parentPhone? }` |
| `/api/students/:id/status` | POST | `{ enrollmentStatus: "active" \| "transferred" \| "withdrawn" }` |
| `/api/teachers` | GET | List teachers (filter with `?schoolId=` / `?employmentStatus=`) |
| `/api/teachers` | POST | `{ schoolId, name, subject }` |
| `/api/teachers/:id/status` | POST | `{ employmentStatus: "active" \| "on_leave" \| "terminated" }` |
| `/api/attendance` | GET | List records (filter with `?studentId=` / `?schoolId=` / `?date=`) |
| `/api/attendance` | POST | `{ studentId, date, status }` — upserts one record per student/date |
| `/api/syllabus` | GET | List entries (filter with `?schoolType=` / `?grade=` / `?term=`) |
| `/api/syllabus` | POST | `{ schoolType, grade, subject, term, topic }` |
| `/api/reports/roster-vs-enrollment` | GET | Active roster count vs. latest reported count per school with roster data |
| `/api/reports/attendance-summary` | GET | Attendance rate per school with attendance data |
| `/api/homework` | GET | List homework assignments (filter with `?schoolId=` / `?grade=`) |
| `/api/notifications` | GET | SMS send history (filter with `?schoolId=` / `?studentId=` / `?messageType=`) |
| `/api/notifications/daily-status` | POST | `{ schoolId, grade?, date? }` → SMS each student's status for that date to their parent |
| `/api/notifications/homework` | POST | `{ schoolId, grade, subject, description, dueDate }` → creates homework and SMS's the grade's parents |
| `/api/notifications/report` | POST | `{ studentId }` → SMS's a one-off attendance + latest-homework summary to that student's parent |

## Deploying publicly (for stakeholder demos)

This app is a single Node process with a SQLite file on local disk, so any
platform that gives you a persistent disk works. It does **not** work on
platforms with an ephemeral/read-only filesystem (e.g. plain Vercel/Netlify
serverless functions) since the database file needs to survive between
requests and restarts.

**Render** (free tier available) — this is how the live demo above is hosted:
1. Push this repo to GitHub.
2. This repo includes a [`render.yaml`](render.yaml) Blueprint, so Render
   Dashboard → Blueprints → New Blueprint Instance → select the repo will
   pre-fill the build/start commands automatically. (Or set up manually:
   New → Web Service → connect the repo → build command `npm install`,
   start command `npm start`.)
3. Add a **persistent disk** (Render dashboard → Disks) mounted at `/data`,
   and set an environment variable so the app writes there — or simply accept
   that on the free tier without a disk, the database resets on each deploy
   (fine for a one-off demo; every fresh boot auto-reseeds itself, see
   [`src/seed.js`](src/seed.js)).

**Railway:**
1. Push to GitHub, then "New Project" → "Deploy from GitHub repo".
2. Railway auto-detects Node and runs `npm install && npm start`.
3. Add a **Volume** mounted at, e.g., `/data` if you need the database to
   survive redeploys; otherwise the default ephemeral filesystem is fine for
   a short demo.

**Fly.io:**
1. `fly launch` in this directory (accept the Node defaults).
2. `fly volumes create data --size 1` and mount it in `fly.toml` at `/data`.
3. `fly deploy`.

In all three cases, for anything beyond a short demo, point `DATA_DIR` at the
mounted volume path instead of the local `data/` folder used in
[`src/db.js`](src/db.js) so the database persists across restarts/redeploys.

## Project structure

```
server.js                    Express app entry point
src/db.js                    SQLite connection + schema (CREATE TABLE ...)
src/auth.js                  Demo login + session token verification
src/anomalyDetection.js      The four fraud-detection rules
src/disbursement.js          TFF claimed-vs-verified calculation
src/sms.js                   Twilio-or-simulate SMS sender
src/seed.js                  Seeds 10 sample schools, two full rosters, teachers, syllabus, homework
src/routes/                  Express routers for each API resource
public/                      Static frontend (HTML/CSS/vanilla JS, no build step)
data/enrollment.db           The SQLite database file (created on first run)
```
