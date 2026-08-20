const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

function rowToRecord(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    schoolId: row.school_id,
    schoolName: row.school_name,
    date: row.date,
    status: row.status,
    recordedBy: row.recorded_by,
  };
}

const SELECT_JOINED = `
  SELECT attendance_records.*, students.name AS student_name, students.school_id AS school_id, schools.name AS school_name
  FROM attendance_records
  JOIN students ON students.id = attendance_records.student_id
  JOIN schools ON schools.id = students.school_id
`;

router.get("/attendance", requireAuth, (req, res) => {
  const { studentId, schoolId, date } = req.query;
  const clauses = [];
  const params = [];
  if (studentId) {
    clauses.push("attendance_records.student_id = ?");
    params.push(Number(studentId));
  }
  if (schoolId) {
    clauses.push("students.school_id = ?");
    params.push(Number(schoolId));
  }
  if (date) {
    clauses.push("attendance_records.date = ?");
    params.push(date);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(`${SELECT_JOINED} ${where} ORDER BY attendance_records.date DESC, students.name LIMIT 200`)
    .all(...params);
  res.json(rows.map(rowToRecord));
});

router.post("/attendance", requireAuth, (req, res) => {
  const { studentId, date, status } = req.body || {};
  if (!studentId || !date || !status) {
    return res.status(400).json({ error: "studentId, date, and status are required." });
  }
  if (!["present", "absent", "late"].includes(status)) {
    return res.status(400).json({ error: "status must be present, absent, or late." });
  }
  const student = db.prepare("SELECT * FROM students WHERE id = ?").get(Number(studentId));
  if (!student) return res.status(404).json({ error: "Student not found." });

  db.prepare(
    `INSERT INTO attendance_records (student_id, date, status, recorded_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status, recorded_by = excluded.recorded_by`
  ).run(student.id, date, status, req.user.username);

  const row = db
    .prepare(`${SELECT_JOINED} WHERE attendance_records.student_id = ? AND attendance_records.date = ?`)
    .get(student.id, date);
  res.status(201).json(rowToRecord(row));
});

module.exports = router;
