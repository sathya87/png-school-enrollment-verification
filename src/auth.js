const crypto = require("node:crypto");
const { db } = require("./db");

// Demo-grade auth: first sign-in with any username creates the account with
// that password; later sign-ins with the same username must match it. No
// password reset, no email verification, no lockout — see README.

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100_000, 32, "sha256").toString("hex");
}

function createSession(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, userId);
  return token;
}

function login(username, password) {
  username = String(username || "").trim();
  password = String(password || "");
  if (!username || !password) {
    return { error: "Username and password are required." };
  }

  const existing = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (!existing) {
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);
    const result = db
      .prepare("INSERT INTO users (username, password_hash, password_salt) VALUES (?, ?, ?)")
      .run(username, passwordHash, salt);
    const userId = Number(result.lastInsertRowid);
    const token = createSession(userId);
    return { token, username, created: true };
  }

  const candidateHash = hashPassword(password, existing.password_salt);
  if (candidateHash !== existing.password_hash) {
    return { error: "Incorrect password for that username." };
  }

  const token = createSession(existing.id);
  return { token, username, created: false };
}

function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing or invalid Authorization header." });

  const session = db
    .prepare(
      `SELECT sessions.token, users.username
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = ?`
    )
    .get(token);

  if (!session) return res.status(401).json({ error: "Invalid or expired session." });

  req.user = { username: session.username };
  next();
}

module.exports = { login, requireAuth };
