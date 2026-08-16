const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "enrollment.db");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS schools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    province TEXT NOT NULL,
    district TEXT NOT NULL,
    school_type TEXT NOT NULL CHECK (school_type IN ('elementary','primary','secondary')),
    classrooms INTEGER NOT NULL DEFAULT 10,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS enrollment_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL REFERENCES schools(id),
    year INTEGER NOT NULL,
    term INTEGER NOT NULL,
    reported_count INTEGER NOT NULL,
    verified_count INTEGER,
    submitted_by TEXT NOT NULL,
    submitted_date TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS anomalies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL REFERENCES enrollment_submissions(id),
    reason TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed_cleared','confirmed_fraud')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_by TEXT,
    resolved_at TEXT,
    resolution_notes TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_submissions_school ON enrollment_submissions(school_id, year, term);
  CREATE INDEX IF NOT EXISTS idx_anomalies_submission ON anomalies(submission_id);
`);

module.exports = { db, DB_PATH };
