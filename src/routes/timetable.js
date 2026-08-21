const express = require("express");
const { db } = require("../db");
const { requireAuth, requireRole } = require("../auth");

const router = express.Router();

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function rowToEntry(row) {
  return {
    id: row.id,
    schoolId: row.school_id,
    schoolName: row.school_name,
    grade: row.grade,
    dayOfWeek: row.day_of_week,
    period: row.period,
    subject: row.subject,
    teacherId: row.teacher_id,
    teacherName: row.teacher_name,
  };
}

const SELECT_JOINED = `
  SELECT timetable_entries.*, schools.name AS school_name, teachers.name AS teacher_name
  FROM timetable_entries
  JOIN schools ON schools.id = timetable_entries.school_id
  LEFT JOIN teachers ON teachers.id = timetable_entries.teacher_id
`;

router.get("/timetable", requireAuth, (req, res) => {
  const { schoolId, grade, dayOfWeek } = req.query;
  const clauses = [];
  const params = [];
  if (schoolId) {
    clauses.push("timetable_entries.school_id = ?");
    params.push(Number(schoolId));
  }
  if (grade) {
    clauses.push("timetable_entries.grade = ?");
    params.push(grade);
  }
  if (dayOfWeek) {
    clauses.push("timetable_entries.day_of_week = ?");
    params.push(dayOfWeek);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(`${SELECT_JOINED} ${where} ORDER BY timetable_entries.day_of_week, timetable_entries.period`)
    .all(...params);
  res.json(rows.map(rowToEntry));
});

router.post("/timetable", requireAuth, requireRole("admin", "teacher"), (req, res) => {
  const { schoolId, grade, dayOfWeek, period, subject, teacherId } = req.body || {};
  if (!schoolId || !grade || !dayOfWeek || !period || !subject) {
    return res.status(400).json({ error: "schoolId, grade, dayOfWeek, period, and subject are required." });
  }
  if (!DAYS.includes(dayOfWeek)) {
    return res.status(400).json({ error: `dayOfWeek must be one of: ${DAYS.join(", ")}.` });
  }
  if (!Number.isInteger(Number(period)) || period < 1 || period > 8) {
    return res.status(400).json({ error: "period must be an integer from 1 to 8." });
  }
  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(Number(schoolId));
  if (!school) return res.status(404).json({ error: "School not found." });

  if (teacherId) {
    // A teacher can't be in two places at once — check across every school,
    // not just this one, since the same person could plausibly be double-
    // booked at a different school's timetable too.
    const clash = db
      .prepare(
        `SELECT timetable_entries.*, schools.name AS school_name FROM timetable_entries
         JOIN schools ON schools.id = timetable_entries.school_id
         WHERE teacher_id = ? AND day_of_week = ? AND period = ?`
      )
      .get(Number(teacherId), dayOfWeek, Number(period));
    if (clash) {
      return res.status(409).json({
        error: `This teacher is already scheduled for ${clash.grade} ${clash.subject} at ${clash.school_name} on ${dayOfWeek} period ${period}.`,
      });
    }
  }

  try {
    const result = db
      .prepare(
        `INSERT INTO timetable_entries (school_id, grade, day_of_week, period, subject, teacher_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(school.id, grade, dayOfWeek, Number(period), subject, teacherId ? Number(teacherId) : null);
    const row = db.prepare(`${SELECT_JOINED} WHERE timetable_entries.id = ?`).get(Number(result.lastInsertRowid));
    res.status(201).json(rowToEntry(row));
  } catch (err) {
    if (String(err.message).includes("UNIQUE constraint failed")) {
      return res.status(409).json({ error: `${grade} already has a class scheduled on ${dayOfWeek} period ${period} at this school.` });
    }
    throw err;
  }
});

router.delete("/timetable/:id", requireAuth, requireRole("admin", "teacher"), (req, res) => {
  const id = Number(req.params.id);
  const entry = db.prepare("SELECT * FROM timetable_entries WHERE id = ?").get(id);
  if (!entry) return res.status(404).json({ error: "Timetable entry not found." });
  db.prepare("DELETE FROM timetable_entries WHERE id = ?").run(id);
  res.json({ ok: true });
});

module.exports = router;
