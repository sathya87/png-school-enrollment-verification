const { db } = require("./db");
const { detectAnomalies } = require("./anomalyDetection");

const SCHOOLS = [
  { name: "Gordons Primary School", province: "National Capital District", district: "Moresby North-East", schoolType: "primary", classrooms: 14 },
  { name: "Kilakila Elementary School", province: "National Capital District", district: "Moresby South", schoolType: "elementary", classrooms: 8 },
  { name: "Bumayong Lutheran Secondary School", province: "Morobe", district: "Lae", schoolType: "secondary", classrooms: 22 },
  { name: "Yalu Primary School", province: "Morobe", district: "Huon Gulf", schoolType: "primary", classrooms: 10 },
  { name: "Kerowagi Primary School", province: "Simbu", district: "Kerowagi", schoolType: "primary", classrooms: 12 },
  { name: "Mt Hagen Secondary School", province: "Western Highlands", district: "Mount Hagen", schoolType: "secondary", classrooms: 20 },
  { name: "Goroka Primary School", province: "Eastern Highlands", district: "Goroka", schoolType: "primary", classrooms: 15 },
  { name: "Kokopo Elementary School", province: "East New Britain", district: "Kokopo", schoolType: "elementary", classrooms: 7 },
  { name: "Wewak Secondary School", province: "East Sepik", district: "Wewak", schoolType: "secondary", classrooms: 18 },
  { name: "Alotau Primary School", province: "Milne Bay", district: "Alotau", schoolType: "primary", classrooms: 11 },
];

function seedSchools() {
  const insert = db.prepare(
    `INSERT INTO schools (name, province, district, school_type, classrooms) VALUES (?, ?, ?, ?, ?)`
  );
  const ids = [];
  for (const s of SCHOOLS) {
    const result = insert.run(s.name, s.province, s.district, s.schoolType, s.classrooms);
    ids.push(Number(result.lastInsertRowid));
  }
  return ids;
}

function insertAndDetect(insertStmt, schoolsById, schoolId, year, term, count, offset) {
  const result = insertStmt.run(schoolId, year, term, count, "district-manager-demo", offset);
  const submission = db
    .prepare("SELECT * FROM enrollment_submissions WHERE id = ?")
    .get(Number(result.lastInsertRowid));
  return detectAnomalies(submission, schoolsById.get(schoolId));
}

function seedEnrollments(schoolIds) {
  const insertSubmission = db.prepare(
    `INSERT INTO enrollment_submissions (school_id, year, term, reported_count, submitted_by, submitted_date)
     VALUES (?, ?, ?, ?, ?, datetime('now', ?))`
  );
  const schoolsById = new Map(
    schoolIds.map((id) => [id, db.prepare("SELECT * FROM schools WHERE id = ?").get(id)])
  );

  // A clean prior-year baseline for every school, term 1 of last year — this
  // gives the year-over-year check something real to compare against.
  const baselines = [320, 180, 610, 240, 260, 540, 340, 150, 470, 250];

  const priorYear = new Date().getFullYear() - 1;
  const thisYear = new Date().getFullYear();

  schoolIds.forEach((schoolId, i) => {
    insertAndDetect(insertSubmission, schoolsById, schoolId, priorYear, 1, baselines[i], "-30 days");
  });

  // This year's term 1, clean and consistent with the baseline — no flags.
  schoolIds.forEach((schoolId, i) => {
    const steady = Math.round(baselines[i] * 1.05);
    insertAndDetect(insertSubmission, schoolsById, schoolId, thisYear, 1, steady, "-10 days");
  });

  // Deliberately inflated case: Bumayong Lutheran Secondary (index 2) claims
  // a 45% jump in term 2 — should trip the year-over-year flag.
  const bumayongId = schoolIds[2];
  insertAndDetect(
    insertSubmission,
    schoolsById,
    bumayongId,
    thisYear,
    2,
    Math.round(baselines[2] * 1.45),
    "-3 days"
  );

  // Capacity-busting case: Kilakila Elementary (index 1, 8 classrooms -> 320
  // cap) claims 410 students in term 2 — should trip the capacity flag.
  const kilakilaId = schoolIds[1];
  insertAndDetect(insertSubmission, schoolsById, kilakilaId, thisYear, 2, 410, "-2 days");

  // Duplicate-submission case: Goroka Primary (index 6) has two separate
  // term-2 submissions this year — should trip the duplicate flag on the
  // second one.
  const gorokaId = schoolIds[6];
  insertAndDetect(insertSubmission, schoolsById, gorokaId, thisYear, 2, 350, "-4 days");
  insertAndDetect(insertSubmission, schoolsById, gorokaId, thisYear, 2, 352, "-1 days");
}

function run({ force } = {}) {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM schools").get().n;
  if (existing > 0 && !force) {
    console.log(`Database already has ${existing} school(s) — skipping seed. Run "npm run seed" to force reseed.`);
    return;
  }
  if (force) {
    db.exec("DELETE FROM anomalies; DELETE FROM enrollment_submissions; DELETE FROM schools;");
  }
  const schoolIds = seedSchools();
  seedEnrollments(schoolIds);
  console.log(`Seeded ${schoolIds.length} schools with sample enrollment history.`);
}

module.exports = { run };

if (require.main === module) {
  const force = process.argv.includes("--force");
  run({ force });
}
