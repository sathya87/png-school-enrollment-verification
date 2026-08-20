const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

function rowToExpert(row) {
  return { username: row.username, name: row.name, subject: row.subject, bio: row.bio, createdAt: row.created_at };
}

router.get("/experts", requireAuth, (req, res) => {
  const { subject } = req.query;
  const rows = subject
    ? db.prepare("SELECT * FROM experts WHERE subject = ? ORDER BY name").all(subject)
    : db.prepare("SELECT * FROM experts ORDER BY name").all();
  res.json(rows.map(rowToExpert));
});

router.get("/experts/me", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM experts WHERE username = ?").get(req.user.username);
  res.json(row ? rowToExpert(row) : null);
});

router.post("/experts/register", requireAuth, (req, res) => {
  const { name, subject, bio } = req.body || {};
  if (!name || !subject) {
    return res.status(400).json({ error: "name and subject are required." });
  }
  db.prepare(
    `INSERT INTO experts (username, name, subject, bio) VALUES (?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET name = excluded.name, subject = excluded.subject, bio = excluded.bio`
  ).run(req.user.username, name, subject, bio || null);
  const row = db.prepare("SELECT * FROM experts WHERE username = ?").get(req.user.username);
  res.status(201).json(rowToExpert(row));
});

module.exports = router;
