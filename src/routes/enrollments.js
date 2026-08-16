const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../auth");
const { detectAnomalies } = require("../anomalyDetection");

const router = express.Router();

function withSchool(submission) {
  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(submission.school_id);
  return {
    id: submission.id,
    schoolId: submission.school_id,
    schoolName: school ? school.name : null,
    province: school ? school.province : null,
    year: submission.year,
    term: submission.term,
    reportedCount: submission.reported_count,
    verifiedCount: submission.verified_count,
    submittedBy: submission.submitted_by,
    submittedDate: submission.submitted_date,
  };
}

router.get("/enrollments", requireAuth, (req, res) => {
  const { schoolId, year, term, province } = req.query;
  const clauses = [];
  const params = [];
  if (schoolId) {
    clauses.push("enrollment_submissions.school_id = ?");
    params.push(Number(schoolId));
  }
  if (year) {
    clauses.push("enrollment_submissions.year = ?");
    params.push(Number(year));
  }
  if (term) {
    clauses.push("enrollment_submissions.term = ?");
    params.push(Number(term));
  }
  if (province) {
    clauses.push("schools.province = ?");
    params.push(province);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT enrollment_submissions.* FROM enrollment_submissions
       JOIN schools ON schools.id = enrollment_submissions.school_id
       ${where}
       ORDER BY enrollment_submissions.id DESC`
    )
    .all(...params);
  res.json(rows.map(withSchool));
});

router.post("/enrollments", requireAuth, (req, res) => {
  const { schoolId, year, term, reportedCount } = req.body || {};
  const submittedBy = req.user.username;

  if (!schoolId || !year || !term || reportedCount == null) {
    return res.status(400).json({ error: "schoolId, year, term, and reportedCount are required." });
  }
  if (Number(reportedCount) < 0) {
    return res.status(400).json({ error: "reportedCount cannot be negative." });
  }
  if (![1, 2, 3, 4].includes(Number(term))) {
    return res.status(400).json({ error: "term must be 1, 2, 3, or 4." });
  }

  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(Number(schoolId));
  if (!school) return res.status(404).json({ error: "School not found." });

  const result = db
    .prepare(
      `INSERT INTO enrollment_submissions (school_id, year, term, reported_count, submitted_by)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(school.id, Number(year), Number(term), Number(reportedCount), submittedBy);

  const submission = db
    .prepare("SELECT * FROM enrollment_submissions WHERE id = ?")
    .get(Number(result.lastInsertRowid));

  const anomalies = detectAnomalies(submission, school);

  res.status(201).json({ submission: withSchool(submission), anomalies });
});

module.exports = router;
