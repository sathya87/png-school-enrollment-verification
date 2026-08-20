const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

function rowToEntry(row) {
  return {
    id: row.id,
    schoolType: row.school_type,
    grade: row.grade,
    subject: row.subject,
    term: row.term,
    topic: row.topic,
  };
}

router.get("/syllabus", requireAuth, (req, res) => {
  const { schoolType, grade, term } = req.query;
  const clauses = [];
  const params = [];
  if (schoolType) {
    clauses.push("school_type = ?");
    params.push(schoolType);
  }
  if (grade) {
    clauses.push("grade = ?");
    params.push(grade);
  }
  if (term) {
    clauses.push("term = ?");
    params.push(Number(term));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM syllabus_entries ${where} ORDER BY school_type, grade, subject`)
    .all(...params);
  res.json(rows.map(rowToEntry));
});

router.post("/syllabus", requireAuth, (req, res) => {
  const { schoolType, grade, subject, term, topic } = req.body || {};
  if (!schoolType || !grade || !subject || !term || !topic) {
    return res.status(400).json({ error: "schoolType, grade, subject, term, and topic are required." });
  }
  if (!["elementary", "primary", "secondary"].includes(schoolType)) {
    return res.status(400).json({ error: "schoolType must be elementary, primary, or secondary." });
  }
  const result = db
    .prepare(`INSERT INTO syllabus_entries (school_type, grade, subject, term, topic) VALUES (?, ?, ?, ?, ?)`)
    .run(schoolType, grade, subject, Number(term), topic);
  const row = db.prepare("SELECT * FROM syllabus_entries WHERE id = ?").get(Number(result.lastInsertRowid));
  res.status(201).json(rowToEntry(row));
});

module.exports = router;
