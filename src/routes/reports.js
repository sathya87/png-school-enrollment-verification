const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

// Compares each school's real named-student roster against its latest
// reported enrollment figure. Only schools with roster data on file are
// included — this is the same ground truth the roster-mismatch anomaly
// check uses, surfaced here as a standing report rather than a one-off flag.
router.get("/reports/roster-vs-enrollment", requireAuth, (req, res) => {
  const schoolsWithRoster = db
    .prepare(
      `SELECT schools.id, schools.name, schools.province,
              COUNT(students.id) AS active_students
       FROM schools
       JOIN students ON students.school_id = schools.id AND students.enrollment_status = 'active'
       GROUP BY schools.id
       HAVING active_students > 0`
    )
    .all();

  const rows = schoolsWithRoster.map((school) => {
    const latest = db
      .prepare(
        `SELECT * FROM enrollment_submissions
         WHERE school_id = ? ORDER BY year DESC, term DESC, id DESC LIMIT 1`
      )
      .get(school.id);
    const reportedCount = latest ? latest.reported_count : null;
    const gapPercent =
      reportedCount != null ? Math.round(((reportedCount - school.active_students) / school.active_students) * 100) : null;
    return {
      schoolId: school.id,
      schoolName: school.name,
      province: school.province,
      activeStudents: school.active_students,
      latestReportedCount: reportedCount,
      gapPercent,
    };
  });

  res.json(rows);
});

// Average attendance rate per school over whatever attendance history exists
// on file (this POC seeds a short recent window; a real deployment would
// filter to a rolling date range).
router.get("/reports/attendance-summary", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT schools.id AS school_id, schools.name AS school_name, schools.province AS province,
              COUNT(*) AS total_records,
              SUM(CASE WHEN attendance_records.status = 'present' THEN 1 ELSE 0 END) AS present_records
       FROM attendance_records
       JOIN students ON students.id = attendance_records.student_id
       JOIN schools ON schools.id = students.school_id
       GROUP BY schools.id`
    )
    .all();

  res.json(
    rows.map((r) => ({
      schoolId: r.school_id,
      schoolName: r.school_name,
      province: r.province,
      totalRecords: r.total_records,
      attendanceRatePercent: Math.round((r.present_records / r.total_records) * 100),
    }))
  );
});

module.exports = router;
