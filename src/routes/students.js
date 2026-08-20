const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

function rowToStudent(row) {
  return {
    id: row.id,
    schoolId: row.school_id,
    schoolName: row.school_name,
    name: row.name,
    grade: row.grade,
    enrollmentStatus: row.enrollment_status,
    dateEnrolled: row.date_enrolled,
    parentName: row.parent_name,
    parentPhone: row.parent_phone,
  };
}

const SELECT_JOINED = `
  SELECT students.*, schools.name AS school_name
  FROM students
  JOIN schools ON schools.id = students.school_id
`;

router.get("/students", requireAuth, (req, res) => {
  const { schoolId, grade, enrollmentStatus } = req.query;
  const clauses = [];
  const params = [];
  if (schoolId) {
    clauses.push("students.school_id = ?");
    params.push(Number(schoolId));
  }
  if (grade) {
    clauses.push("students.grade = ?");
    params.push(grade);
  }
  if (enrollmentStatus) {
    clauses.push("students.enrollment_status = ?");
    params.push(enrollmentStatus);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`${SELECT_JOINED} ${where} ORDER BY schools.name, students.grade, students.name`).all(...params);
  res.json(rows.map(rowToStudent));
});

router.post("/students", requireAuth, (req, res) => {
  const { schoolId, name, grade, parentName, parentPhone } = req.body || {};
  if (!schoolId || !name || !grade) {
    return res.status(400).json({ error: "schoolId, name, and grade are required." });
  }
  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(Number(schoolId));
  if (!school) return res.status(404).json({ error: "School not found." });

  const result = db
    .prepare(`INSERT INTO students (school_id, name, grade, parent_name, parent_phone) VALUES (?, ?, ?, ?, ?)`)
    .run(school.id, name, grade, parentName || null, parentPhone || null);
  const row = db.prepare(`${SELECT_JOINED} WHERE students.id = ?`).get(Number(result.lastInsertRowid));
  res.status(201).json(rowToStudent(row));
});

router.post("/students/:id/status", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { enrollmentStatus } = req.body || {};
  if (!["active", "transferred", "withdrawn"].includes(enrollmentStatus)) {
    return res.status(400).json({ error: "enrollmentStatus must be active, transferred, or withdrawn." });
  }
  const student = db.prepare("SELECT * FROM students WHERE id = ?").get(id);
  if (!student) return res.status(404).json({ error: "Student not found." });

  db.prepare("UPDATE students SET enrollment_status = ? WHERE id = ?").run(enrollmentStatus, id);
  const row = db.prepare(`${SELECT_JOINED} WHERE students.id = ?`).get(id);
  res.json(rowToStudent(row));
});

module.exports = router;
