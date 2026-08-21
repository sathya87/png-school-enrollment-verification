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
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('student','teacher','admin','district_manager','expert')),
    student_id INTEGER REFERENCES students(id),
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

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL REFERENCES schools(id),
    name TEXT NOT NULL,
    grade TEXT NOT NULL,
    enrollment_status TEXT NOT NULL DEFAULT 'active' CHECK (enrollment_status IN ('active','transferred','withdrawn')),
    date_enrolled TEXT NOT NULL DEFAULT (datetime('now')),
    parent_name TEXT,
    parent_phone TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL REFERENCES schools(id),
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    employment_status TEXT NOT NULL DEFAULT 'active' CHECK (employment_status IN ('active','on_leave','terminated')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS syllabus_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_type TEXT NOT NULL CHECK (school_type IN ('elementary','primary','secondary')),
    grade TEXT NOT NULL,
    subject TEXT NOT NULL,
    term INTEGER NOT NULL,
    topic TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attendance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('present','absent','late')),
    recorded_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (student_id, date)
  );

  CREATE TABLE IF NOT EXISTS homework_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL REFERENCES schools(id),
    grade TEXT NOT NULL,
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    due_date TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sms_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    phone TEXT NOT NULL,
    message_type TEXT NOT NULL CHECK (message_type IN ('daily_status','homework','report')),
    body TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('sent','simulated','failed')),
    provider_message_id TEXT,
    sent_by TEXT NOT NULL,
    sent_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS experts (
    username TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    bio TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS video_class_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_name TEXT NOT NULL,
    school_id INTEGER REFERENCES schools(id),
    subject TEXT NOT NULL,
    topic TEXT NOT NULL,
    preferred_time TEXT,
    status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','accepted','completed','cancelled')),
    requested_by TEXT NOT NULL,
    expert_username TEXT REFERENCES experts(username),
    room_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    accepted_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS video_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    sender_username TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('offer','answer','ice')),
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_submissions_school ON enrollment_submissions(school_id, year, term);
  CREATE INDEX IF NOT EXISTS idx_anomalies_submission ON anomalies(submission_id);
  CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id, enrollment_status);
  CREATE INDEX IF NOT EXISTS idx_teachers_school ON teachers(school_id, employment_status);
  CREATE INDEX IF NOT EXISTS idx_syllabus_lookup ON syllabus_entries(school_type, grade, term);
  CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance_records(student_id, date);
  CREATE INDEX IF NOT EXISTS idx_homework_school ON homework_assignments(school_id, grade);
  CREATE INDEX IF NOT EXISTS idx_sms_log_student ON sms_log(student_id, sent_at);
  CREATE INDEX IF NOT EXISTS idx_video_requests_status ON video_class_requests(status, subject);
  CREATE INDEX IF NOT EXISTS idx_video_signals_room ON video_signals(room_id, id);
`);

module.exports = { db, DB_PATH };
