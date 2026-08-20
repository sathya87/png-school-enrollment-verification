const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

function rowToTeacher(row) {
  return {
    id: row.id,
    schoolId: row.school_id,
    schoolName: row.school_name,
    name: row.name,
    subject: row.subject,
    employmentStatus: row.employment_status,
  };
}

const SELECT_JOINED = `
  SELECT teachers.*, schools.name AS school_name
  FROM teachers
  JOIN schools ON schools.id = teachers.school_id
`;

router.get("/teachers", requireAuth, (req, res) => {
  const { schoolId, employmentStatus } = req.query;
  const clauses = [];
  const params = [];
  if (schoolId) {
    clauses.push("teachers.school_id = ?");
    params.push(Number(schoolId));
  }
  if (employmentStatus) {
    clauses.push("teachers.employment_status = ?");
    params.push(employmentStatus);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`${SELECT_JOINED} ${where} ORDER BY schools.name, teachers.name`).all(...params);
  res.json(rows.map(rowToTeacher));
});

router.post("/teachers", requireAuth, (req, res) => {
  const { schoolId, name, subject } = req.body || {};
  if (!schoolId || !name || !subject) {
    return res.status(400).json({ error: "schoolId, name, and subject are required." });
  }
  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(Number(schoolId));
  if (!school) return res.status(404).json({ error: "School not found." });

  const result = db
    .prepare(`INSERT INTO teachers (school_id, name, subject) VALUES (?, ?, ?)`)
    .run(school.id, name, subject);
  const row = db.prepare(`${SELECT_JOINED} WHERE teachers.id = ?`).get(Number(result.lastInsertRowid));
  res.status(201).json(rowToTeacher(row));
});

router.post("/teachers/:id/status", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { employmentStatus } = req.body || {};
  if (!["active", "on_leave", "terminated"].includes(employmentStatus)) {
    return res.status(400).json({ error: "employmentStatus must be active, on_leave, or terminated." });
  }
  const teacher = db.prepare("SELECT * FROM teachers WHERE id = ?").get(id);
  if (!teacher) return res.status(404).json({ error: "Teacher not found." });

  db.prepare("UPDATE teachers SET employment_status = ? WHERE id = ?").run(employmentStatus, id);
  const row = db.prepare(`${SELECT_JOINED} WHERE teachers.id = ?`).get(id);
  res.json(rowToTeacher(row));
});

module.exports = router;
