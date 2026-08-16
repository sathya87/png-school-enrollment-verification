const { db } = require("./db");

// Illustrative per-student annual TFF rates in Kina for this POC only — they
// are NOT the National Department of Education's official published TFF
// rates, which vary by school type/grade and are set by policy each year.
// See README.
const TFF_RATE_PER_STUDENT_KINA = {
  elementary: 100,
  primary: 150,
  secondary: 250,
};

/**
 * A submission's "verified" figure is its verified_count if a reviewer has
 * set one (i.e. an anomaly on it was confirmed as fraud and corrected),
 * otherwise its reported_count stands as verified (nothing flagged it, or
 * a flag was reviewed and cleared).
 */
function verifiedCountFor(submission) {
  return submission.verified_count != null ? submission.verified_count : submission.reported_count;
}

function calculateDisbursement(schoolId) {
  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(schoolId);
  if (!school) return { error: "School not found." };

  const latest = db
    .prepare(
      `SELECT * FROM enrollment_submissions
       WHERE school_id = ?
       ORDER BY year DESC, term DESC, id DESC
       LIMIT 1`
    )
    .get(schoolId);

  const rate = TFF_RATE_PER_STUDENT_KINA[school.school_type] ?? 0;

  if (!latest) {
    return {
      school: { id: school.id, name: school.name, province: school.province, schoolType: school.school_type },
      ratePerStudentKina: rate,
      message: "No enrollment submission on file for this school yet.",
      reportedCount: 0,
      verifiedCount: 0,
      claimedAmountKina: 0,
      verifiedAmountKina: 0,
      gapKina: 0,
    };
  }

  const verifiedCount = verifiedCountFor(latest);
  const claimedAmountKina = latest.reported_count * rate;
  const verifiedAmountKina = verifiedCount * rate;

  return {
    school: { id: school.id, name: school.name, province: school.province, schoolType: school.school_type },
    year: latest.year,
    term: latest.term,
    ratePerStudentKina: rate,
    reportedCount: latest.reported_count,
    verifiedCount,
    claimedAmountKina,
    verifiedAmountKina,
    gapKina: claimedAmountKina - verifiedAmountKina,
  };
}

module.exports = { calculateDisbursement, TFF_RATE_PER_STUDENT_KINA };
