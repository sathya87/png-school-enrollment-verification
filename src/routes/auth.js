const express = require("express");
const { db } = require("../db");
const { login } = require("../auth");

const router = express.Router();

router.post("/login", (req, res) => {
  const { username, password, role, studentId } = req.body || {};
  const result = login(username, password, role, studentId);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

// Unauthenticated lookups the login screen needs before a session exists —
// a role picker (school, then student roster) for the "student" role.
// Deliberately excludes parent contact info; only what's needed to pick a
// record, not sensitive data.
router.get("/public/schools", (req, res) => {
  const rows = db.prepare("SELECT id, name, province FROM schools ORDER BY province, name").all();
  res.json(rows.map((r) => ({ id: r.id, name: r.name, province: r.province })));
});

router.get("/public/students", (req, res) => {
  const { schoolId } = req.query;
  if (!schoolId) return res.status(400).json({ error: "schoolId is required." });
  const rows = db
    .prepare("SELECT id, name, grade FROM students WHERE school_id = ? AND enrollment_status = 'active' ORDER BY grade, name")
    .all(Number(schoolId));
  res.json(rows.map((r) => ({ id: r.id, name: r.name, grade: r.grade })));
});

module.exports = router;
