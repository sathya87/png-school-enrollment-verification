const { db } = require("./db");

// Same-type-classroom capacity rule: PNG classrooms are not meant to exceed
// roughly 40 students each. A school's plausible ceiling is its classroom
// count times this figure. Reporting above that ceiling is treated as
// implausible on its face, regardless of year-over-year history.
const STUDENTS_PER_CLASSROOM_CEILING = 40;

// A report more than this fraction above the same school/term's prior-year
// figure is flagged as a suspicious jump.
const YOY_INCREASE_FLAG_THRESHOLD = 0.2;
const YOY_INCREASE_HIGH_SEVERITY_THRESHOLD = 0.5;

// A report more than this fraction above the school's actual named-student
// roster (students table) is flagged as likely phantom/ghost enrollment —
// this is the closest thing this POC has to the independent cross-check
// (attendance registers, physical headcounts) the README describes as
// missing from pure year-over-year statistics.
const ROSTER_MISMATCH_THRESHOLD = 0.15;
const ROSTER_MISMATCH_HIGH_SEVERITY_THRESHOLD = 0.4;

/**
 * Runs all anomaly checks for a just-inserted submission and inserts any
 * triggered anomaly rows. Returns the list of anomalies created (each as
 * the full row, including its new id).
 */
function detectAnomalies(submission, school) {
  const found = [];

  const priorYear = db
    .prepare(
      `SELECT * FROM enrollment_submissions
       WHERE school_id = ? AND term = ? AND year = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(submission.school_id, submission.term, submission.year - 1);

  if (priorYear) {
    const priorCount = priorYear.reported_count;
    const increaseFraction = priorCount > 0 ? (submission.reported_count - priorCount) / priorCount : 0;
    if (increaseFraction > YOY_INCREASE_FLAG_THRESHOLD) {
      const pct = Math.round(increaseFraction * 100);
      found.push({
        reason: `Reported enrollment (${submission.reported_count}) is ${pct}% higher than the same school/term's prior-year figure (${priorCount} in ${submission.year - 1}).`,
        severity: increaseFraction > YOY_INCREASE_HIGH_SEVERITY_THRESHOLD ? "high" : "medium",
      });
    }
  }

  const capacity = school.classrooms * STUDENTS_PER_CLASSROOM_CEILING;
  if (submission.reported_count > capacity) {
    found.push({
      reason: `Reported enrollment (${submission.reported_count}) exceeds the school's classroom capacity ceiling (${school.classrooms} classrooms x ${STUDENTS_PER_CLASSROOM_CEILING} = ${capacity}).`,
      severity: "high",
    });
  }

  const rosterCount = db
    .prepare(`SELECT COUNT(*) AS n FROM students WHERE school_id = ? AND enrollment_status = 'active'`)
    .get(submission.school_id).n;

  if (rosterCount > 0) {
    const gapFraction = (submission.reported_count - rosterCount) / rosterCount;
    if (gapFraction > ROSTER_MISMATCH_THRESHOLD) {
      const pct = Math.round(gapFraction * 100);
      found.push({
        reason: `Reported enrollment (${submission.reported_count}) is ${pct}% higher than the school's actual named-student roster (${rosterCount} active students on file) — possible phantom/ghost student inflation.`,
        severity: gapFraction > ROSTER_MISMATCH_HIGH_SEVERITY_THRESHOLD ? "high" : "medium",
      });
    }
  }

  const duplicateCount = db
    .prepare(
      `SELECT COUNT(*) AS n FROM enrollment_submissions
       WHERE school_id = ? AND year = ? AND term = ? AND id != ?`
    )
    .get(submission.school_id, submission.year, submission.term, submission.id).n;

  if (duplicateCount > 0) {
    found.push({
      reason: `This school already has ${duplicateCount} other submission(s) for year ${submission.year} term ${submission.term} — possible duplicate or resubmission.`,
      severity: "high",
    });
  }

  const insertAnomaly = db.prepare(
    `INSERT INTO anomalies (submission_id, reason, severity) VALUES (?, ?, ?)`
  );
  const created = [];
  for (const anomaly of found) {
    const result = insertAnomaly.run(submission.id, anomaly.reason, anomaly.severity);
    created.push({ id: Number(result.lastInsertRowid), submission_id: submission.id, status: "open", ...anomaly });
  }
  return created;
}

module.exports = {
  detectAnomalies,
  STUDENTS_PER_CLASSROOM_CEILING,
  YOY_INCREASE_FLAG_THRESHOLD,
  ROSTER_MISMATCH_THRESHOLD,
};
