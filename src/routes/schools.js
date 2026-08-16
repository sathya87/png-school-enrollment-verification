const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

router.get("/schools", requireAuth, (req, res) => {
  const { province, schoolType } = req.query;
  const clauses = [];
  const params = [];
  if (province) {
    clauses.push("province = ?");
    params.push(province);
  }
  if (schoolType) {
    clauses.push("school_type = ?");
    params.push(schoolType);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const schools = db.prepare(`SELECT * FROM schools ${where} ORDER BY province, name`).all(...params);
  res.json(schools);
});

router.post("/schools", requireAuth, (req, res) => {
  const { name, province, district, schoolType, classrooms } = req.body || {};
  if (!name || !province || !district || !schoolType) {
    return res.status(400).json({ error: "name, province, district, and schoolType are required." });
  }
  if (!["elementary", "primary", "secondary"].includes(schoolType)) {
    return res.status(400).json({ error: "schoolType must be elementary, primary, or secondary." });
  }
  const result = db
    .prepare(
      `INSERT INTO schools (name, province, district, school_type, classrooms) VALUES (?, ?, ?, ?, ?)`
    )
    .run(name, province, district, schoolType, Number(classrooms) || 10);
  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(Number(result.lastInsertRowid));
  res.status(201).json(school);
});

module.exports = router;
