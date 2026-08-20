const express = require("express");
const crypto = require("node:crypto");
const { db } = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

function rowToRequest(row) {
  return {
    id: row.id,
    studentName: row.student_name,
    schoolId: row.school_id,
    schoolName: row.school_name || null,
    subject: row.subject,
    topic: row.topic,
    preferredTime: row.preferred_time,
    status: row.status,
    requestedBy: row.requested_by,
    expertUsername: row.expert_username,
    expertName: row.expert_name || null,
    roomId: row.room_id,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    completedAt: row.completed_at,
  };
}

const SELECT_JOINED = `
  SELECT video_class_requests.*, schools.name AS school_name, experts.name AS expert_name
  FROM video_class_requests
  LEFT JOIN schools ON schools.id = video_class_requests.school_id
  LEFT JOIN experts ON experts.username = video_class_requests.expert_username
`;

router.get("/video-requests", requireAuth, (req, res) => {
  const { status, subject } = req.query;
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push("video_class_requests.status = ?");
    params.push(status);
  }
  if (subject) {
    clauses.push("video_class_requests.subject = ?");
    params.push(subject);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`${SELECT_JOINED} ${where} ORDER BY video_class_requests.id DESC LIMIT 100`).all(...params);
  res.json(rows.map(rowToRequest));
});

router.get("/video-requests/:id", requireAuth, (req, res) => {
  const row = db.prepare(`${SELECT_JOINED} WHERE video_class_requests.id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Request not found." });
  res.json(rowToRequest(row));
});

router.post("/video-requests", requireAuth, (req, res) => {
  const { studentName, schoolId, subject, topic, preferredTime } = req.body || {};
  if (!studentName || !subject || !topic) {
    return res.status(400).json({ error: "studentName, subject, and topic are required." });
  }
  const result = db
    .prepare(
      `INSERT INTO video_class_requests (student_name, school_id, subject, topic, preferred_time, requested_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(studentName, schoolId ? Number(schoolId) : null, subject, topic, preferredTime || null, req.user.username);
  const row = db.prepare(`${SELECT_JOINED} WHERE video_class_requests.id = ?`).get(Number(result.lastInsertRowid));
  res.status(201).json(rowToRequest(row));
});

router.post("/video-requests/:id/accept", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const expert = db.prepare("SELECT * FROM experts WHERE username = ?").get(req.user.username);
  if (!expert) return res.status(403).json({ error: "Register as an expert before accepting a class request." });

  const request = db.prepare("SELECT * FROM video_class_requests WHERE id = ?").get(id);
  if (!request) return res.status(404).json({ error: "Request not found." });
  if (request.status !== "requested") {
    return res.status(400).json({ error: `This request is already ${request.status}.` });
  }

  const roomId = crypto.randomBytes(8).toString("hex");
  db.prepare(
    `UPDATE video_class_requests SET status = 'accepted', expert_username = ?, room_id = ?, accepted_at = datetime('now')
     WHERE id = ?`
  ).run(req.user.username, roomId, id);

  const row = db.prepare(`${SELECT_JOINED} WHERE video_class_requests.id = ?`).get(id);
  res.json(rowToRequest(row));
});

router.post("/video-requests/:id/complete", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const request = db.prepare("SELECT * FROM video_class_requests WHERE id = ?").get(id);
  if (!request) return res.status(404).json({ error: "Request not found." });
  if (request.requested_by !== req.user.username && request.expert_username !== req.user.username) {
    return res.status(403).json({ error: "Only the requester or the accepted expert can end this class." });
  }
  db.prepare("UPDATE video_class_requests SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(id);
  const row = db.prepare(`${SELECT_JOINED} WHERE video_class_requests.id = ?`).get(id);
  res.json(rowToRequest(row));
});

// ---------- WebRTC signaling (polling-based — no WebSocket dependency) ----------
//
// Peers exchange SDP offers/answers and ICE candidates by posting to and
// polling this endpoint for the request's room. Each peer only ever
// receives messages sent by the *other* participant. This trades a little
// connection-setup latency (poll interval) for staying on the same
// plain-REST/SQLite stack as the rest of this POC — see README.

router.post("/video-requests/:id/signals", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { type, payload } = req.body || {};
  if (!["offer", "answer", "ice"].includes(type) || payload == null) {
    return res.status(400).json({ error: "type (offer|answer|ice) and payload are required." });
  }
  const request = db.prepare("SELECT * FROM video_class_requests WHERE id = ?").get(id);
  if (!request || !request.room_id) return res.status(404).json({ error: "Request or room not found." });
  if (request.requested_by !== req.user.username && request.expert_username !== req.user.username) {
    return res.status(403).json({ error: "Only the requester or the accepted expert can join this call." });
  }

  db.prepare(
    `INSERT INTO video_signals (room_id, sender_username, type, payload) VALUES (?, ?, ?, ?)`
  ).run(request.room_id, req.user.username, type, JSON.stringify(payload));
  res.status(201).json({ ok: true });
});

router.get("/video-requests/:id/signals", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const after = Number(req.query.after) || 0;
  const request = db.prepare("SELECT * FROM video_class_requests WHERE id = ?").get(id);
  if (!request || !request.room_id) return res.status(404).json({ error: "Request or room not found." });

  const rows = db
    .prepare(
      `SELECT * FROM video_signals WHERE room_id = ? AND id > ? AND sender_username != ? ORDER BY id ASC LIMIT 50`
    )
    .all(request.room_id, after, req.user.username);

  res.json(rows.map((r) => ({ id: r.id, type: r.type, payload: JSON.parse(r.payload), sender: r.sender_username })));
});

module.exports = router;
