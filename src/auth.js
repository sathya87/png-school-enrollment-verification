const crypto = require("node:crypto");
const { db } = require("./db");

// Demo-grade auth: first sign-in with any username creates the account with
// that password; later sign-ins with the same username must match it. No
// password reset, no email verification, no lockout — see README.
//
// Role is picked at the login form on every sign-in (not stored permanently
// on the account) — the simplest way to demo role-based access without a
// registration/approval workflow. A "student" role must also identify which
// existing student record they are, by self-selecting from their school's
// roster — see README.

const ROLES = ["student", "teacher", "admin", "district_manager", "expert"];

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100_000, 32, "sha256").toString("hex");
}

function createSession(userId, role, studentId) {
  const token = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id, role, student_id) VALUES (?, ?, ?, ?)").run(
    token,
    userId,
    role,
    studentId || null
  );
  return token;
}

function login(username, password, role, studentId) {
  username = String(username || "").trim();
  password = String(password || "");
  if (!username || !password) {
    return { error: "Username and password are required." };
  }
  if (!ROLES.includes(role)) {
    return { error: `role must be one of: ${ROLES.join(", ")}.` };
  }

  let resolvedStudentId = null;
  if (role === "student") {
    if (!studentId) return { error: "Select your name from the roster to sign in as a student." };
    const student = db.prepare("SELECT * FROM students WHERE id = ? AND enrollment_status = 'active'").get(Number(studentId));
    if (!student) return { error: "That student record was not found or is not active." };
    resolvedStudentId = student.id;
  }

  const existing = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (!existing) {
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);
    const result = db
      .prepare("INSERT INTO users (username, password_hash, password_salt) VALUES (?, ?, ?)")
      .run(username, passwordHash, salt);
    const userId = Number(result.lastInsertRowid);
    const token = createSession(userId, role, resolvedStudentId);
    return { token, username, role, studentId: resolvedStudentId, created: true };
  }

  const candidateHash = hashPassword(password, existing.password_salt);
  if (candidateHash !== existing.password_hash) {
    return { error: "Incorrect password for that username." };
  }

  const token = createSession(existing.id, role, resolvedStudentId);
  return { token, username, role, studentId: resolvedStudentId, created: false };
}

function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing or invalid Authorization header." });

  const session = db
    .prepare(
      `SELECT sessions.token, sessions.role, sessions.student_id, users.username
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = ?`
    )
    .get(token);

  if (!session) return res.status(401).json({ error: "Invalid or expired session." });

  req.user = { username: session.username, role: session.role, studentId: session.student_id };
  next();
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `This action requires one of these roles: ${allowedRoles.join(", ")}.` });
    }
    next();
  };
}

module.exports = { login, requireAuth, requireRole, ROLES };
