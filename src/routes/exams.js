const express = require("express");
const { db } = require("../db");
const { requireAuth, requireRole } = require("../auth");

const router = express.Router();

function rowToRecord(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    subject: row.subject,
    term: row.term,
    assessmentName: row.assessment_name,
    score: row.score,
    maxScore: row.max_score,
    percent: Math.round((row.score / row.max_score) * 100),
    recordedBy: row.recorded_by,
    recordedAt: row.recorded_at,
  };
}

const SELECT_JOINED = `
  SELECT exam_records.*, students.name AS student_name
  FROM exam_records
  JOIN students ON students.id = exam_records.student_id
`;

// A student role may only ever see their own records; every other role can
// filter by any studentId. This is enforced here rather than left to the
// frontend, since the frontend is just a UI convenience, not a security
// boundary.
function resolveStudentFilter(req) {
  if (req.user.role === "student") return req.user.studentId;
  return req.query.studentId ? Number(req.query.studentId) : null;
}

router.get("/exams", requireAuth, (req, res) => {
  const studentId = resolveStudentFilter(req);
  const { subject, term } = req.query;
  const clauses = [];
  const params = [];
  if (studentId) {
    clauses.push("exam_records.student_id = ?");
    params.push(studentId);
  }
  if (subject) {
    clauses.push("exam_records.subject = ?");
    params.push(subject);
  }
  if (term) {
    clauses.push("exam_records.term = ?");
    params.push(Number(term));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(`${SELECT_JOINED} ${where} ORDER BY exam_records.id DESC LIMIT 200`)
    .all(...params);
  res.json(rows.map(rowToRecord));
});

router.post("/exams", requireAuth, requireRole("admin", "teacher"), (req, res) => {
  const { studentId, subject, term, assessmentName, score, maxScore } = req.body || {};
  if (!studentId || !subject || !term || !assessmentName || score == null) {
    return res.status(400).json({ error: "studentId, subject, term, assessmentName, and score are required." });
  }
  const student = db.prepare("SELECT * FROM students WHERE id = ?").get(Number(studentId));
  if (!student) return res.status(404).json({ error: "Student not found." });
  if (Number(score) < 0) return res.status(400).json({ error: "score cannot be negative." });

  const result = db
    .prepare(
      `INSERT INTO exam_records (student_id, subject, term, assessment_name, score, max_score, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(student.id, subject, Number(term), assessmentName, Number(score), Number(maxScore) || 100, req.user.username);
  const row = db.prepare(`${SELECT_JOINED} WHERE exam_records.id = ?`).get(Number(result.lastInsertRowid));
  res.status(201).json(rowToRecord(row));
});

router.get("/report-card/:studentId", requireAuth, (req, res) => {
  const studentId = Number(req.params.studentId);
  if (req.user.role === "student" && req.user.studentId !== studentId) {
    return res.status(403).json({ error: "Students can only view their own report card." });
  }
  const student = db.prepare("SELECT * FROM students WHERE id = ?").get(studentId);
  if (!student) return res.status(404).json({ error: "Student not found." });

  const { term } = req.query;
  const clauses = ["student_id = ?"];
  const params = [studentId];
  if (term) {
    clauses.push("term = ?");
    params.push(Number(term));
  }
  const records = db
    .prepare(`SELECT * FROM exam_records WHERE ${clauses.join(" AND ")} ORDER BY subject`)
    .all(...params);

  const bySubject = new Map();
  for (const r of records) {
    if (!bySubject.has(r.subject)) bySubject.set(r.subject, []);
    bySubject.get(r.subject).push(r);
  }
  const subjects = Array.from(bySubject.entries()).map(([subject, recs]) => {
    const totalPercent = recs.reduce((sum, r) => sum + (r.score / r.max_score) * 100, 0);
    return {
      subject,
      assessmentCount: recs.length,
      averagePercent: Math.round(totalPercent / recs.length),
    };
  });
  const overallPercent = subjects.length
    ? Math.round(subjects.reduce((sum, s) => sum + s.averagePercent, 0) / subjects.length)
    : null;

  res.json({
    studentId: student.id,
    studentName: student.name,
    grade: student.grade,
    term: term ? Number(term) : null,
    subjects,
    overallPercent,
  });
});

module.exports = router;
