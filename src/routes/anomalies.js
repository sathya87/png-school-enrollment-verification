const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

function rowToAnomaly(row) {
  return {
    id: row.id,
    submissionId: row.submission_id,
    reason: row.reason,
    severity: row.severity,
    status: row.status,
    createdAt: row.created_at,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    resolutionNotes: row.resolution_notes,
    schoolId: row.school_id,
    schoolName: row.school_name,
    province: row.province,
    year: row.year,
    term: row.term,
    reportedCount: row.reported_count,
    verifiedCount: row.verified_count,
    submittedBy: row.submitted_by,
  };
}

const SELECT_JOINED = `
  SELECT
    anomalies.*,
    schools.id AS school_id,
    schools.name AS school_name,
    schools.province AS province,
    enrollment_submissions.year AS year,
    enrollment_submissions.term AS term,
    enrollment_submissions.reported_count AS reported_count,
    enrollment_submissions.verified_count AS verified_count,
    enrollment_submissions.submitted_by AS submitted_by
  FROM anomalies
  JOIN enrollment_submissions ON enrollment_submissions.id = anomalies.submission_id
  JOIN schools ON schools.id = enrollment_submissions.school_id
`;

router.get("/anomalies", requireAuth, (req, res) => {
  const { severity, status, province } = req.query;
  const clauses = [];
  const params = [];
  if (severity) {
    clauses.push("anomalies.severity = ?");
    params.push(severity);
  }
  if (status) {
    clauses.push("anomalies.status = ?");
    params.push(status);
  }
  if (province) {
    clauses.push("schools.province = ?");
    params.push(province);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`${SELECT_JOINED} ${where} ORDER BY anomalies.id DESC`).all(...params);
  res.json(rows.map(rowToAnomaly));
});

router.post("/anomalies/:id/resolve", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { status, notes, verifiedCount } = req.body || {};

  if (!["reviewed_cleared", "confirmed_fraud"].includes(status)) {
    return res.status(400).json({ error: "status must be reviewed_cleared or confirmed_fraud." });
  }

  const anomaly = db.prepare("SELECT * FROM anomalies WHERE id = ?").get(id);
  if (!anomaly) return res.status(404).json({ error: "Anomaly not found." });

  db.prepare(
    `UPDATE anomalies SET status = ?, resolved_by = ?, resolved_at = datetime('now'), resolution_notes = ?
     WHERE id = ?`
  ).run(status, req.user.username, notes || null, id);

  if (status === "confirmed_fraud") {
    const submission = db
      .prepare("SELECT * FROM enrollment_submissions WHERE id = ?")
      .get(anomaly.submission_id);
    // Default the corrected figure to the school's prior-year submission for
    // the same term if the reviewer doesn't supply a specific verified
    // count — funding is withheld down to the last figure we trust.
    let correctedCount = verifiedCount;
    if (correctedCount == null) {
      const prior = db
        .prepare(
          `SELECT * FROM enrollment_submissions
           WHERE school_id = ? AND term = ? AND year = ? AND id != ?
           ORDER BY id DESC LIMIT 1`
        )
        .get(submission.school_id, submission.term, submission.year - 1, submission.id);
      correctedCount = prior ? prior.reported_count : 0;
    }
    db.prepare("UPDATE enrollment_submissions SET verified_count = ? WHERE id = ?").run(
      Number(correctedCount),
      submission.id
    );
  }

  const updated = db.prepare(`${SELECT_JOINED} WHERE anomalies.id = ?`).get(id);
  res.json(rowToAnomaly(updated));
});

module.exports = router;
