const path = require("node:path");
const express = require("express");
const { db } = require("./src/db");
const seed = require("./src/seed");

const authRoutes = require("./src/routes/auth");
const schoolRoutes = require("./src/routes/schools");
const enrollmentRoutes = require("./src/routes/enrollments");
const anomalyRoutes = require("./src/routes/anomalies");
const disbursementRoutes = require("./src/routes/disbursement");
const studentRoutes = require("./src/routes/students");
const teacherRoutes = require("./src/routes/teachers");
const attendanceRoutes = require("./src/routes/attendance");
const syllabusRoutes = require("./src/routes/syllabus");
const reportRoutes = require("./src/routes/reports");
const notificationRoutes = require("./src/routes/notifications");
const expertRoutes = require("./src/routes/experts");
const videoClassRoutes = require("./src/routes/videoClasses");
const timetableRoutes = require("./src/routes/timetable");
const examRoutes = require("./src/routes/exams");

// Seed automatically on a fresh database so the demo has data immediately
// after `npm install && npm start` — see src/seed.js.
seed.run();

const app = express();
app.use(express.json());

app.use("/api", authRoutes);
app.use("/api", schoolRoutes);
app.use("/api", enrollmentRoutes);
app.use("/api", anomalyRoutes);
app.use("/api", disbursementRoutes);
app.use("/api", studentRoutes);
app.use("/api", teacherRoutes);
app.use("/api", attendanceRoutes);
app.use("/api", syllabusRoutes);
app.use("/api", reportRoutes);
app.use("/api", notificationRoutes);
app.use("/api", expertRoutes);
app.use("/api", videoClassRoutes);
app.use("/api", timetableRoutes);
app.use("/api", examRoutes);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`PNG School Enrollment Verification & Anti-Fraud System listening on http://localhost:${PORT}`);
  console.log(`Database file: ${require("./src/db").DB_PATH}`);
});

module.exports = { app, db };
