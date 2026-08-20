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

const FIRST_NAMES = [
  "Kila", "Peter", "Meri", "John", "Ruth", "Simon", "Grace", "Michael", "Elizabeth", "Joseph",
  "Martha", "David", "Ansu", "Dorcas", "Wari", "Lucy", "Andrew", "Naomi", "Steven", "Rachel",
];
const LAST_NAMES = [
  "Waigani", "Kaupa", "Toua", "Namaliu", "Are", "Sioni", "Guina", "Kaiulo",
  "Bani", "Kori", "Vagi", "Rimoro", "Wamela", "Aisi", "Kamit", "Buri",
];

function personName(index) {
  return `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length]}`;
}

const GRADES_BY_SCHOOL_TYPE = {
  elementary: ["Elementary Prep", "Elementary 1", "Elementary 2"],
  primary: ["Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7", "Grade 8"],
  secondary: ["Grade 9", "Grade 10", "Grade 11", "Grade 12"],
};

const TEACHER_SUBJECTS = [
  "Mathematics", "English", "Science", "Social Science",
  "Physical Education", "Arts", "Language & Culture", "Business Studies",
];

const SYLLABUS_TOPICS = {
  elementary: {
    Language: "Oral storytelling and beginning literacy in the child's own language",
    Mathematics: "Counting, number recognition, and simple pattern-making",
    "Culture & Community": "Local customs, family roles, and community helpers",
  },
  primary: {
    English: "Reading comprehension and paragraph writing",
    Mathematics: "Fractions, decimals, and basic geometry",
    Science: "Life cycles, weather patterns, and simple ecosystems",
    "Social Science": "PNG provinces, government structure, and civic responsibility",
  },
  secondary: {
    English: "Essay composition and PNG/Commonwealth literature",
    Mathematics: "Algebra, trigonometry, and introductory statistics",
    Science: "Cell biology, chemical reactions, and basic physics",
    "Business Studies": "Bookkeeping, entrepreneurship, and cooperative societies",
  },
};

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

function seedTeachers(schoolIds, schools) {
  const insert = db.prepare(
    `INSERT INTO teachers (school_id, name, subject, employment_status) VALUES (?, ?, ?, ?)`
  );
  let nameIndex = 0;
  schoolIds.forEach((schoolId, i) => {
    const teacherCount = 3 + (i % 3); // 3-5 teachers per school
    for (let t = 0; t < teacherCount; t++) {
      const status = t === teacherCount - 1 && i % 4 === 0 ? "on_leave" : "active";
      insert.run(schoolId, personName(nameIndex + 500), TEACHER_SUBJECTS[t % TEACHER_SUBJECTS.length], status);
      nameIndex++;
    }
  });
}

/** Formats a deterministic PNG-style mobile number for demo parent contacts. */
function demoPhone(index) {
  const digits = String(70000000 + (index % 9999999)).padStart(8, "0");
  return `+675 ${digits.slice(0, 3)} ${digits.slice(3)}`;
}

/** Inserts `count` active students (with parent contact info) for a school and returns their ids. */
function seedStudentRoster(schoolId, schoolType, count) {
  const insert = db.prepare(
    `INSERT INTO students (school_id, name, grade, enrollment_status, parent_name, parent_phone)
     VALUES (?, ?, ?, 'active', ?, ?)`
  );
  const grades = GRADES_BY_SCHOOL_TYPE[schoolType];
  const ids = [];
  for (let i = 0; i < count; i++) {
    // Parents get a name from a shifted slice of the same pool so a
    // student and their parent don't share the exact same generated name.
    const result = insert.run(schoolId, personName(i), grades[i % grades.length], personName(i + 900), demoPhone(i));
    ids.push(Number(result.lastInsertRowid));
  }
  return ids;
}

/** Records attendance for the given students over the last `days` calendar days. */
function seedAttendance(studentIds, days) {
  const insert = db.prepare(
    `INSERT INTO attendance_records (student_id, date, status, recorded_by)
     VALUES (?, date('now', ?), ?, 'teacher-demo')`
  );
  for (let d = 1; d <= days; d++) {
    const offset = `-${d} days`;
    studentIds.forEach((studentId, i) => {
      // Mostly present, with a small rotating slice absent/late for realism.
      const mod = (studentId + d) % 20;
      const status = mod === 0 ? "absent" : mod === 1 ? "late" : "present";
      insert.run(studentId, offset, status);
    });
  }
}

function seedSyllabus() {
  const insert = db.prepare(
    `INSERT INTO syllabus_entries (school_type, grade, subject, term, topic) VALUES (?, ?, ?, 1, ?)`
  );
  for (const [schoolType, grades] of Object.entries(GRADES_BY_SCHOOL_TYPE)) {
    const subjects = SYLLABUS_TOPICS[schoolType];
    for (const grade of grades.slice(0, 2)) {
      for (const [subject, topic] of Object.entries(subjects)) {
        insert.run(schoolType, grade, subject, topic);
      }
    }
  }
}

function run({ force } = {}) {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM schools").get().n;
  if (existing > 0 && !force) {
    console.log(`Database already has ${existing} school(s) — skipping seed. Run "npm run seed" to force reseed.`);
    return;
  }
  if (force) {
    db.exec(`
      DELETE FROM sms_log;
      DELETE FROM homework_assignments;
      DELETE FROM attendance_records;
      DELETE FROM students;
      DELETE FROM teachers;
      DELETE FROM syllabus_entries;
      DELETE FROM anomalies;
      DELETE FROM enrollment_submissions;
      DELETE FROM schools;
    `);
  }
  const schoolIds = seedSchools();
  seedEnrollments(schoolIds);
  seedTeachers(schoolIds, SCHOOLS);
  seedSyllabus();

  // Gordons Primary (index 0): a near-complete roster that matches its
  // reported figures closely — demonstrates the "clean" case where roster
  // cross-checking finds nothing wrong.
  const gordonsId = schoolIds[0];
  const gordonsRoster = seedStudentRoster(gordonsId, "primary", 328);
  seedAttendance(gordonsRoster, 5);

  // Kerowagi Primary (index 4): a real, named roster of 220 students, but
  // the district office reports 340 for a new term — a 55% gap that the
  // year-over-year and capacity checks alone would not catch. This is the
  // "phantom/ghost student" fraud pattern the roster-mismatch check exists
  // to demonstrate.
  const kerowagiId = schoolIds[4];
  const kerowagiRoster = seedStudentRoster(kerowagiId, "primary", 220);
  seedAttendance(kerowagiRoster, 5);

  const insertSubmission = db.prepare(
    `INSERT INTO enrollment_submissions (school_id, year, term, reported_count, submitted_by, submitted_date)
     VALUES (?, ?, ?, ?, ?, datetime('now', ?))`
  );
  const schoolsById = new Map(schoolIds.map((id) => [id, db.prepare("SELECT * FROM schools WHERE id = ?").get(id)]));
  insertAndDetect(insertSubmission, schoolsById, kerowagiId, new Date().getFullYear(), 3, 340, "-1 days");

  const insertHomework = db.prepare(
    `INSERT INTO homework_assignments (school_id, grade, subject, description, due_date, created_by, created_at)
     VALUES (?, ?, ?, ?, date('now', '+3 days'), 'district-manager-demo', datetime('now', '-1 days'))`
  );
  insertHomework.run(gordonsId, "Grade 5", "Mathematics", "Complete worksheet 4: fractions and decimals, questions 1-15.");
  insertHomework.run(kerowagiId, "Grade 3", "English", "Read chapter 2 of the reader and write a 5-sentence summary.");

  console.log(`Seeded ${schoolIds.length} schools with enrollment history, teachers, syllabus, two student rosters with attendance and parent contacts, and sample homework.`);
}

module.exports = { run };

if (require.main === module) {
  const force = process.argv.includes("--force");
  run({ force });
}
