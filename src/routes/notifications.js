const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../auth");
const { sendSms } = require("../sms");

const router = express.Router();

function rowToLogEntry(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    schoolName: row.school_name,
    phone: row.phone,
    messageType: row.message_type,
    body: row.body,
    status: row.status,
    sentBy: row.sent_by,
    sentAt: row.sent_at,
  };
}

const LOG_SELECT_JOINED = `
  SELECT sms_log.*, students.name AS student_name, schools.name AS school_name
  FROM sms_log
  JOIN students ON students.id = sms_log.student_id
  JOIN schools ON schools.id = students.school_id
`;

async function sendAndLog(student, messageType, body, sentBy) {
  const result = await sendSms(student.parent_phone, body);
  const status = result.ok ? (result.simulated ? "simulated" : "sent") : "failed";
  const insert = db.prepare(
    `INSERT INTO sms_log (student_id, phone, message_type, body, status, provider_message_id, sent_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const inserted = insert.run(
    student.id,
    student.parent_phone,
    messageType,
    body,
    status,
    result.providerMessageId || null,
    sentBy
  );
  return db.prepare(`${LOG_SELECT_JOINED} WHERE sms_log.id = ?`).get(Number(inserted.lastInsertRowid));
}

router.get("/notifications", requireAuth, (req, res) => {
  const { schoolId, studentId, messageType } = req.query;
  const clauses = [];
  const params = [];
  if (schoolId) {
    clauses.push("students.school_id = ?");
    params.push(Number(schoolId));
  }
  if (studentId) {
    clauses.push("sms_log.student_id = ?");
    params.push(Number(studentId));
  }
  if (messageType) {
    clauses.push("sms_log.message_type = ?");
    params.push(messageType);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`${LOG_SELECT_JOINED} ${where} ORDER BY sms_log.id DESC LIMIT 200`).all(...params);
  res.json(rows.map(rowToLogEntry));
});

router.get("/homework", requireAuth, (req, res) => {
  const { schoolId, grade } = req.query;
  const clauses = [];
  const params = [];
  if (schoolId) {
    clauses.push("school_id = ?");
    params.push(Number(schoolId));
  }
  if (grade) {
    clauses.push("grade = ?");
    params.push(grade);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM homework_assignments ${where} ORDER BY id DESC LIMIT 100`).all(...params);
  res.json(
    rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      grade: r.grade,
      subject: r.subject,
      description: r.description,
      dueDate: r.due_date,
      createdBy: r.created_by,
      createdAt: r.created_at,
    }))
  );
});

function activeStudentsWithPhone(schoolId, grade) {
  const clauses = ["school_id = ?", "enrollment_status = 'active'", "parent_phone IS NOT NULL"];
  const params = [Number(schoolId)];
  if (grade) {
    clauses.push("grade = ?");
    params.push(grade);
  }
  return db.prepare(`SELECT * FROM students WHERE ${clauses.join(" AND ")}`).all(...params);
}

router.post("/notifications/daily-status", requireAuth, async (req, res) => {
  const { schoolId, grade, date } = req.body || {};
  if (!schoolId) return res.status(400).json({ error: "schoolId is required." });

  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(Number(schoolId));
  if (!school) return res.status(404).json({ error: "School not found." });

  const targetDate = date || db.prepare("SELECT date('now') AS d").get().d;
  const students = activeStudentsWithPhone(schoolId, grade);

  const summary = { attempted: 0, sent: 0, simulated: 0, failed: 0, skippedNoAttendance: 0 };
  for (const student of students) {
    const attendance = db
      .prepare("SELECT * FROM attendance_records WHERE student_id = ? AND date = ?")
      .get(student.id, targetDate);
    if (!attendance) {
      summary.skippedNoAttendance++;
      continue;
    }
    summary.attempted++;
    const body = `Dear parent/guardian, ${student.name} was marked ${attendance.status.toUpperCase()} at ${school.name} on ${targetDate}.`;
    const logRow = await sendAndLog(student, "daily_status", body, req.user.username);
    summary[logRow.status === "simulated" ? "simulated" : logRow.status === "sent" ? "sent" : "failed"]++;
  }

  res.json({ date: targetDate, ...summary });
});

router.post("/notifications/homework", requireAuth, async (req, res) => {
  const { schoolId, grade, subject, description, dueDate } = req.body || {};
  if (!schoolId || !grade || !subject || !description || !dueDate) {
    return res.status(400).json({ error: "schoolId, grade, subject, description, and dueDate are required." });
  }
  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(Number(schoolId));
  if (!school) return res.status(404).json({ error: "School not found." });

  const inserted = db
    .prepare(
      `INSERT INTO homework_assignments (school_id, grade, subject, description, due_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(school.id, grade, subject, description, dueDate, req.user.username);
  const homework = db.prepare("SELECT * FROM homework_assignments WHERE id = ?").get(Number(inserted.lastInsertRowid));

  const students = activeStudentsWithPhone(schoolId, grade);
  const summary = { attempted: students.length, sent: 0, simulated: 0, failed: 0 };
  const body = `Homework for ${grade} ${subject} (due ${dueDate}): ${description}`;
  for (const student of students) {
    const logRow = await sendAndLog(student, "homework", body, req.user.username);
    summary[logRow.status === "simulated" ? "simulated" : logRow.status === "sent" ? "sent" : "failed"]++;
  }

  res.status(201).json({
    homework: {
      id: homework.id,
      schoolId: homework.school_id,
      grade: homework.grade,
      subject: homework.subject,
      description: homework.description,
      dueDate: homework.due_date,
    },
    notified: summary,
  });
});

router.post("/notifications/report", requireAuth, async (req, res) => {
  const { studentId } = req.body || {};
  if (!studentId) return res.status(400).json({ error: "studentId is required." });

  const student = db.prepare("SELECT * FROM students WHERE id = ?").get(Number(studentId));
  if (!student) return res.status(404).json({ error: "Student not found." });
  if (!student.parent_phone) return res.status(400).json({ error: "This student has no parent phone number on file." });

  const attendance = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present
       FROM attendance_records WHERE student_id = ?`
    )
    .get(student.id);
  const attendanceRate = attendance.total > 0 ? Math.round((attendance.present / attendance.total) * 100) : null;

  const latestHomework = db
    .prepare("SELECT * FROM homework_assignments WHERE school_id = ? AND grade = ? ORDER BY id DESC LIMIT 1")
    .get(student.school_id, student.grade);

  const parts = [`Report for ${student.name}:`];
  parts.push(attendanceRate != null ? `attendance ${attendanceRate}% on file.` : "no attendance on file yet.");
  parts.push(
    latestHomework
      ? `Latest homework: ${latestHomework.subject} — ${latestHomework.description} (due ${latestHomework.due_date}).`
      : "No homework on file yet."
  );
  const body = parts.join(" ");

  const logRow = await sendAndLog(student, "report", body, req.user.username);
  res.status(201).json(rowToLogEntry(logRow));
});

module.exports = router;
