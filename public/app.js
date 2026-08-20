const state = {
  token: localStorage.getItem("token") || null,
  username: localStorage.getItem("username") || null,
  schools: [],
};

const PROVINCES = [
  "National Capital District", "Central", "Morobe", "Madang", "East Sepik", "West Sepik",
  "Enga", "Western Highlands", "Eastern Highlands", "Southern Highlands", "Hela", "Jiwaka",
  "Simbu", "Gulf", "Western", "Oro", "Milne Bay", "Manus", "New Ireland",
  "East New Britain", "West New Britain", "Bougainville",
];

function money(kina) {
  return "K" + Number(kina).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function severityBadge(sev) {
  return `<span class="badge badge-${sev}">${sev}</span>`;
}

function statusBadge(status) {
  const labels = { open: "Open", reviewed_cleared: "Reviewed — cleared", confirmed_fraud: "Confirmed fraud" };
  return `<span class="badge badge-${status}">${labels[status] || status}</span>`;
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`/api${path}`, { ...options, headers });
  if (res.status === 401) {
    logout();
    throw new Error("Session expired — please sign in again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

// ---------- Auth ----------

function showApp() {
  document.getElementById("login-screen").hidden = true;
  document.getElementById("app-screen").hidden = false;
  document.getElementById("current-username").textContent = state.username;
  bootApp();
}

function showLogin() {
  document.getElementById("login-screen").hidden = false;
  document.getElementById("app-screen").hidden = true;
}

function logout() {
  state.token = null;
  state.username = null;
  localStorage.removeItem("token");
  localStorage.removeItem("username");
  showLogin();
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("login-username").value;
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.hidden = true;
  try {
    const result = await api("/login", { method: "POST", body: JSON.stringify({ username, password }) });
    state.token = result.token;
    state.username = result.username;
    localStorage.setItem("token", state.token);
    localStorage.setItem("username", state.username);
    showApp();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
});

document.getElementById("logout-btn").addEventListener("click", logout);

// ---------- Tabs ----------

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// ---------- Bootstrap ----------

const SCHOOL_SELECT_IDS = [
  "submission-school", "disbursement-school", "student-school", "teacher-school",
  "attendance-school", "daily-status-school", "homework-school", "report-send-school",
];
const SCHOOL_FILTER_SELECT_IDS = [
  "students-filter-school", "teachers-filter-school", "attendance-filter-school", "notifications-filter-school",
];

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function bootApp() {
  await loadSchools();
  populateProvinceFilter();
  document.getElementById("submission-year").value = new Date().getFullYear();
  document.getElementById("attendance-date").value = dateOffset(0);
  document.getElementById("daily-status-date").value = dateOffset(-1);
  document.getElementById("homework-due").value = dateOffset(3);
  await loadRecentSubmissions();
  await loadAnomalies();
  await loadStudents();
  await loadTeachers();
  await loadAttendance();
  await loadSyllabus();
  await loadReports();
  await loadNotifications();
  await loadExpertProfile();
  await loadOpenRequests();
  await loadMyClasses();
}

async function loadSchools() {
  state.schools = await api("/schools");
  const options = state.schools
    .map((s) => `<option value="${s.id}">${s.name} — ${s.province}</option>`)
    .join("");
  SCHOOL_SELECT_IDS.forEach((id) => {
    document.getElementById(id).innerHTML = options;
  });
  SCHOOL_FILTER_SELECT_IDS.forEach((id) => {
    document.getElementById(id).innerHTML = `<option value="">All</option>` + options;
  });
  document.getElementById("video-request-school").innerHTML = `<option value="">—</option>` + options;
  await refreshStudentSelectFor("attendance-school", "attendance-student");
  await refreshStudentSelectFor("report-send-school", "report-send-student");
}

/** Populates a student <select> with the active roster of whichever school is selected in schoolSelectId. */
async function refreshStudentSelectFor(schoolSelectId, studentSelectId) {
  const schoolId = document.getElementById(schoolSelectId).value;
  const studentSelect = document.getElementById(studentSelectId);
  if (!schoolId) {
    studentSelect.innerHTML = "";
    return;
  }
  const students = await api(`/students?schoolId=${schoolId}&enrollmentStatus=active`);
  studentSelect.innerHTML = students
    .map((s) => `<option value="${s.id}">${s.name} — ${s.grade}${s.parentPhone ? "" : " (no parent phone on file)"}</option>`)
    .join("");
}

document.getElementById("attendance-school").addEventListener("change", () => refreshStudentSelectFor("attendance-school", "attendance-student"));
document.getElementById("report-send-school").addEventListener("change", () => refreshStudentSelectFor("report-send-school", "report-send-student"));

function populateProvinceFilter() {
  const provinces = [...new Set(state.schools.map((s) => s.province))].sort();
  const select = document.getElementById("filter-province");
  select.innerHTML =
    `<option value="">All</option>` + provinces.map((p) => `<option value="${p}">${p}</option>`).join("");
}

// ---------- Submit enrollment ----------

document.getElementById("submission-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const resultEl = document.getElementById("submission-result");
  resultEl.innerHTML = "";

  const payload = {
    schoolId: Number(document.getElementById("submission-school").value),
    year: Number(document.getElementById("submission-year").value),
    term: Number(document.getElementById("submission-term").value),
    reportedCount: Number(document.getElementById("submission-count").value),
  };

  try {
    const { submission, anomalies } = await api("/enrollments", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (anomalies.length === 0) {
      resultEl.innerHTML = `<div class="banner success">Submission for <strong>${submission.schoolName}</strong> (${submission.reportedCount} students, Year ${submission.year} Term ${submission.term}) recorded — no anomalies detected.</div>`;
    } else {
      resultEl.innerHTML = `
        <div class="banner flagged">
          <strong>Submission recorded, but flagged ${anomalies.length} ${anomalies.length === 1 ? "anomaly" : "anomalies"} for review:</strong>
          <ul>${anomalies.map((a) => `<li>${severityBadge(a.severity)} ${a.reason}</li>`).join("")}</ul>
        </div>`;
    }

    document.getElementById("submission-count").value = "";
    await loadRecentSubmissions();
    await loadAnomalies();
  } catch (err) {
    resultEl.innerHTML = `<div class="banner flagged">${err.message}</div>`;
  }
});

async function loadRecentSubmissions() {
  const rows = await api("/enrollments");
  const recent = rows.slice(0, 10);
  const container = document.getElementById("recent-submissions");
  if (recent.length === 0) {
    container.innerHTML = "<p>No submissions yet.</p>";
    return;
  }
  container.innerHTML = `
    <table>
      <thead><tr><th>School</th><th>Province</th><th>Year</th><th>Term</th><th>Reported</th><th>Submitted by</th><th>Submitted</th></tr></thead>
      <tbody>
        ${recent
          .map(
            (r) => `<tr>
          <td>${r.schoolName}</td>
          <td>${r.province}</td>
          <td>${r.year}</td>
          <td>${r.term}</td>
          <td>${r.reportedCount}</td>
          <td>${r.submittedBy}</td>
          <td>${new Date(r.submittedDate + "Z").toLocaleString()}</td>
        </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

// ---------- Flagged anomalies ----------

async function loadAnomalies() {
  const params = new URLSearchParams();
  const severity = document.getElementById("filter-severity").value;
  const province = document.getElementById("filter-province").value;
  const status = document.getElementById("filter-status").value;
  if (severity) params.set("severity", severity);
  if (province) params.set("province", province);
  if (status) params.set("status", status);

  const anomalies = await api(`/anomalies?${params.toString()}`);
  const container = document.getElementById("anomalies-list");

  if (anomalies.length === 0) {
    container.innerHTML = "<p>No anomalies match this filter.</p>";
    return;
  }

  container.innerHTML = anomalies
    .map(
      (a) => `
    <div class="anomaly-card severity-${a.severity}" data-id="${a.id}">
      <div class="anomaly-top">
        <h4>${a.schoolName}</h4>
        ${severityBadge(a.severity)} ${statusBadge(a.status)}
      </div>
      <p class="anomaly-meta">${a.province} · Year ${a.year} Term ${a.term} · Reported ${a.reportedCount}${a.verifiedCount != null ? ` · Verified ${a.verifiedCount}` : ""} · Submitted by ${a.submittedBy}</p>
      <p class="anomaly-reason">${a.reason}</p>
      ${
        a.status === "open"
          ? `<div class="anomaly-actions">
              <button class="btn-clear" data-action="clear" data-id="${a.id}">Reviewed — cleared</button>
              <button class="btn-danger" data-action="fraud" data-id="${a.id}">Confirm fraud, withhold funding</button>
            </div>`
          : `<p class="anomaly-resolution">Resolved by ${a.resolvedBy} on ${new Date(a.resolvedAt + "Z").toLocaleString()}${a.resolutionNotes ? ` — "${a.resolutionNotes}"` : ""}</p>`
      }
    </div>`
    )
    .join("");
}

document.getElementById("anomalies-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;

  try {
    if (btn.dataset.action === "clear") {
      await api(`/anomalies/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ status: "reviewed_cleared" }),
      });
    } else if (btn.dataset.action === "fraud") {
      const verifiedInput = window.prompt(
        "Verified enrollment count for this submission (funding will be paid on this figure instead). Leave blank to fall back to the prior-year figure:"
      );
      if (verifiedInput === null) return; // cancelled
      const notes = window.prompt("Notes for the record (optional):") || "";
      const body = { status: "confirmed_fraud", notes };
      if (verifiedInput.trim() !== "") body.verifiedCount = Number(verifiedInput);
      await api(`/anomalies/${id}/resolve`, { method: "POST", body: JSON.stringify(body) });
    }
    await loadAnomalies();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("refresh-anomalies").addEventListener("click", loadAnomalies);
["filter-severity", "filter-province", "filter-status"].forEach((id) =>
  document.getElementById(id).addEventListener("change", loadAnomalies)
);

// ---------- TFF disbursement calculator ----------

document.getElementById("disbursement-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const schoolId = document.getElementById("disbursement-school").value;
  const resultEl = document.getElementById("disbursement-result");
  resultEl.innerHTML = "Calculating…";

  try {
    const d = await api(`/disbursement/${schoolId}`);
    if (d.message) {
      resultEl.innerHTML = `<div class="banner flagged">${d.message}</div>`;
      return;
    }
    const gap = d.gapKina;
    resultEl.innerHTML = `
      <p class="anomaly-meta">${d.school.name} · ${d.school.province} · ${d.school.schoolType} · Year ${d.year} Term ${d.term} · Rate ${money(d.ratePerStudentKina)}/student/yr</p>
      <div class="disbursement-grid">
        <div class="stat"><div class="stat-label">Reported count</div><div class="stat-value">${d.reportedCount}</div></div>
        <div class="stat"><div class="stat-label">Verified count</div><div class="stat-value">${d.verifiedCount}</div></div>
        <div class="stat"><div class="stat-label">Amount claimed</div><div class="stat-value">${money(d.claimedAmountKina)}</div></div>
        <div class="stat"><div class="stat-label">Amount due (verified)</div><div class="stat-value">${money(d.verifiedAmountKina)}</div></div>
        <div class="stat gap ${gap === 0 ? "zero" : ""}"><div class="stat-label">Funding gap</div><div class="stat-value">${money(gap)}</div></div>
      </div>`;
  } catch (err) {
    resultEl.innerHTML = `<div class="banner flagged">${err.message}</div>`;
  }
});

// ---------- Students ----------

function statusBadge2(value, goodValues) {
  const cls = goodValues.includes(value) ? "low" : "medium";
  return `<span class="badge badge-${cls}">${value.replace("_", " ")}</span>`;
}

document.getElementById("student-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/students", {
      method: "POST",
      body: JSON.stringify({
        schoolId: Number(document.getElementById("student-school").value),
        name: document.getElementById("student-name").value,
        grade: document.getElementById("student-grade").value,
        parentName: document.getElementById("student-parent-name").value || null,
        parentPhone: document.getElementById("student-parent-phone").value || null,
      }),
    });
    ["student-name", "student-grade", "student-parent-name", "student-parent-phone"].forEach(
      (id) => (document.getElementById(id).value = "")
    );
    await loadStudents();
  } catch (err) {
    alert(err.message);
  }
});

async function loadStudents() {
  const schoolId = document.getElementById("students-filter-school").value;
  const enrollmentStatus = document.getElementById("students-filter-status").value;
  const params = new URLSearchParams();
  if (schoolId) params.set("schoolId", schoolId);
  if (enrollmentStatus) params.set("enrollmentStatus", enrollmentStatus);

  const students = await api(`/students?${params.toString()}`);
  const container = document.getElementById("students-list");
  if (students.length === 0) {
    container.innerHTML = "<p>No students match this filter.</p>";
    return;
  }
  const shown = students.slice(0, 50);
  container.innerHTML = `
    ${students.length > shown.length ? `<p class="anomaly-meta">Showing ${shown.length} of ${students.length} students.</p>` : ""}
    <table>
      <thead><tr><th>Name</th><th>School</th><th>Grade</th><th>Status</th><th>Parent/guardian</th><th>Phone</th><th>Update status</th></tr></thead>
      <tbody>
        ${shown
          .map(
            (s) => `<tr>
          <td>${s.name}</td>
          <td>${s.schoolName}</td>
          <td>${s.grade}</td>
          <td>${statusBadge2(s.enrollmentStatus, ["active"])}</td>
          <td>${s.parentName || "—"}</td>
          <td>${s.parentPhone || "—"}</td>
          <td>
            <select data-student-status-id="${s.id}">
              <option value="active" ${s.enrollmentStatus === "active" ? "selected" : ""}>Active</option>
              <option value="transferred" ${s.enrollmentStatus === "transferred" ? "selected" : ""}>Transferred</option>
              <option value="withdrawn" ${s.enrollmentStatus === "withdrawn" ? "selected" : ""}>Withdrawn</option>
            </select>
          </td>
        </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

document.getElementById("students-list").addEventListener("change", async (e) => {
  const select = e.target.closest("select[data-student-status-id]");
  if (!select) return;
  try {
    await api(`/students/${select.dataset.studentStatusId}/status`, {
      method: "POST",
      body: JSON.stringify({ enrollmentStatus: select.value }),
    });
    await loadStudents();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("refresh-students").addEventListener("click", loadStudents);
["students-filter-school", "students-filter-status"].forEach((id) =>
  document.getElementById(id).addEventListener("change", loadStudents)
);

// ---------- Teachers ----------

document.getElementById("teacher-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/teachers", {
      method: "POST",
      body: JSON.stringify({
        schoolId: Number(document.getElementById("teacher-school").value),
        name: document.getElementById("teacher-name").value,
        subject: document.getElementById("teacher-subject").value,
      }),
    });
    ["teacher-name", "teacher-subject"].forEach((id) => (document.getElementById(id).value = ""));
    await loadTeachers();
  } catch (err) {
    alert(err.message);
  }
});

async function loadTeachers() {
  const schoolId = document.getElementById("teachers-filter-school").value;
  const params = new URLSearchParams();
  if (schoolId) params.set("schoolId", schoolId);

  const teachers = await api(`/teachers?${params.toString()}`);
  const container = document.getElementById("teachers-list");
  if (teachers.length === 0) {
    container.innerHTML = "<p>No teachers match this filter.</p>";
    return;
  }
  container.innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>School</th><th>Subject</th><th>Status</th><th>Update status</th></tr></thead>
      <tbody>
        ${teachers
          .map(
            (t) => `<tr>
          <td>${t.name}</td>
          <td>${t.schoolName}</td>
          <td>${t.subject}</td>
          <td>${statusBadge2(t.employmentStatus, ["active"])}</td>
          <td>
            <select data-teacher-status-id="${t.id}">
              <option value="active" ${t.employmentStatus === "active" ? "selected" : ""}>Active</option>
              <option value="on_leave" ${t.employmentStatus === "on_leave" ? "selected" : ""}>On leave</option>
              <option value="terminated" ${t.employmentStatus === "terminated" ? "selected" : ""}>Terminated</option>
            </select>
          </td>
        </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

document.getElementById("teachers-list").addEventListener("change", async (e) => {
  const select = e.target.closest("select[data-teacher-status-id]");
  if (!select) return;
  try {
    await api(`/teachers/${select.dataset.teacherStatusId}/status`, {
      method: "POST",
      body: JSON.stringify({ employmentStatus: select.value }),
    });
    await loadTeachers();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("refresh-teachers").addEventListener("click", loadTeachers);
document.getElementById("teachers-filter-school").addEventListener("change", loadTeachers);

// ---------- Attendance ----------

document.getElementById("attendance-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/attendance", {
      method: "POST",
      body: JSON.stringify({
        studentId: Number(document.getElementById("attendance-student").value),
        date: document.getElementById("attendance-date").value,
        status: document.getElementById("attendance-status").value,
      }),
    });
    await loadAttendance();
  } catch (err) {
    alert(err.message);
  }
});

async function loadAttendance() {
  const schoolId = document.getElementById("attendance-filter-school").value;
  const params = new URLSearchParams();
  if (schoolId) params.set("schoolId", schoolId);

  const records = await api(`/attendance?${params.toString()}`);
  const container = document.getElementById("attendance-list");
  if (records.length === 0) {
    container.innerHTML = "<p>No attendance records match this filter.</p>";
    return;
  }
  container.innerHTML = `
    <table>
      <thead><tr><th>Date</th><th>Student</th><th>School</th><th>Status</th><th>Recorded by</th></tr></thead>
      <tbody>
        ${records
          .slice(0, 50)
          .map(
            (r) => `<tr>
          <td>${r.date}</td>
          <td>${r.studentName}</td>
          <td>${r.schoolName}</td>
          <td>${statusBadge2(r.status, ["present"])}</td>
          <td>${r.recordedBy}</td>
        </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

document.getElementById("refresh-attendance").addEventListener("click", loadAttendance);
document.getElementById("attendance-filter-school").addEventListener("change", loadAttendance);

// ---------- Syllabus ----------

document.getElementById("syllabus-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/syllabus", {
      method: "POST",
      body: JSON.stringify({
        schoolType: document.getElementById("syllabus-school-type").value,
        grade: document.getElementById("syllabus-grade").value,
        subject: document.getElementById("syllabus-subject").value,
        term: Number(document.getElementById("syllabus-term").value),
        topic: document.getElementById("syllabus-topic").value,
      }),
    });
    ["syllabus-grade", "syllabus-subject", "syllabus-topic"].forEach((id) => (document.getElementById(id).value = ""));
    await loadSyllabus();
  } catch (err) {
    alert(err.message);
  }
});

async function loadSyllabus() {
  const schoolType = document.getElementById("syllabus-filter-type").value;
  const params = new URLSearchParams();
  if (schoolType) params.set("schoolType", schoolType);

  const entries = await api(`/syllabus?${params.toString()}`);
  const container = document.getElementById("syllabus-list");
  if (entries.length === 0) {
    container.innerHTML = "<p>No syllabus entries match this filter.</p>";
    return;
  }
  container.innerHTML = `
    <table>
      <thead><tr><th>School type</th><th>Grade</th><th>Subject</th><th>Term</th><th>Topic</th></tr></thead>
      <tbody>
        ${entries
          .map(
            (e) => `<tr>
          <td>${e.schoolType}</td>
          <td>${e.grade}</td>
          <td>${e.subject}</td>
          <td>${e.term}</td>
          <td>${e.topic}</td>
        </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

document.getElementById("refresh-syllabus").addEventListener("click", loadSyllabus);
document.getElementById("syllabus-filter-type").addEventListener("change", loadSyllabus);

// ---------- Reports ----------

async function loadReports() {
  const roster = await api("/reports/roster-vs-enrollment");
  const rosterEl = document.getElementById("report-roster");
  rosterEl.innerHTML = roster.length
    ? `<table>
        <thead><tr><th>School</th><th>Province</th><th>Active students</th><th>Latest reported</th><th>Gap</th></tr></thead>
        <tbody>
          ${roster
            .map(
              (r) => `<tr>
            <td>${r.schoolName}</td>
            <td>${r.province}</td>
            <td>${r.activeStudents}</td>
            <td>${r.latestReportedCount ?? "—"}</td>
            <td><span class="badge badge-${r.gapPercent > 15 ? "high" : r.gapPercent > 0 ? "medium" : "low"}">${r.gapPercent ?? 0}%</span></td>
          </tr>`
            )
            .join("")}
        </tbody>
      </table>`
    : "<p>No schools have roster data on file yet.</p>";

  const attendance = await api("/reports/attendance-summary");
  const attendanceEl = document.getElementById("report-attendance");
  attendanceEl.innerHTML = attendance.length
    ? `<table>
        <thead><tr><th>School</th><th>Province</th><th>Records on file</th><th>Attendance rate</th></tr></thead>
        <tbody>
          ${attendance
            .map(
              (a) => `<tr>
            <td>${a.schoolName}</td>
            <td>${a.province}</td>
            <td>${a.totalRecords}</td>
            <td><span class="badge badge-${a.attendanceRatePercent < 80 ? "high" : a.attendanceRatePercent < 90 ? "medium" : "low"}">${a.attendanceRatePercent}%</span></td>
          </tr>`
            )
            .join("")}
        </tbody>
      </table>`
    : "<p>No attendance records on file yet.</p>";
}

document.getElementById("refresh-reports").addEventListener("click", loadReports);

// ---------- Parent notifications ----------

document.getElementById("daily-status-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const resultEl = document.getElementById("daily-status-result");
  try {
    const r = await api("/notifications/daily-status", {
      method: "POST",
      body: JSON.stringify({
        schoolId: Number(document.getElementById("daily-status-school").value),
        grade: document.getElementById("daily-status-grade").value || null,
        date: document.getElementById("daily-status-date").value || null,
      }),
    });
    resultEl.innerHTML = `<div class="banner success">Daily status for ${r.date}: ${r.sent + r.simulated} sent (${r.simulated} simulated), ${r.failed} failed, ${r.skippedNoAttendance} skipped (no attendance recorded for that date).</div>`;
    await loadNotifications();
  } catch (err) {
    resultEl.innerHTML = `<div class="banner flagged">${err.message}</div>`;
  }
});

document.getElementById("homework-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const resultEl = document.getElementById("homework-result");
  try {
    const r = await api("/notifications/homework", {
      method: "POST",
      body: JSON.stringify({
        schoolId: Number(document.getElementById("homework-school").value),
        grade: document.getElementById("homework-grade").value,
        subject: document.getElementById("homework-subject").value,
        description: document.getElementById("homework-description").value,
        dueDate: document.getElementById("homework-due").value,
      }),
    });
    resultEl.innerHTML = `<div class="banner success">Homework created and sent to ${r.notified.attempted} parent(s) (${r.notified.sent + r.notified.simulated} sent, ${r.notified.simulated} simulated, ${r.notified.failed} failed).</div>`;
    document.getElementById("homework-description").value = "";
    await loadNotifications();
  } catch (err) {
    resultEl.innerHTML = `<div class="banner flagged">${err.message}</div>`;
  }
});

document.getElementById("report-send-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const resultEl = document.getElementById("report-send-result");
  try {
    const r = await api("/notifications/report", {
      method: "POST",
      body: JSON.stringify({ studentId: Number(document.getElementById("report-send-student").value) }),
    });
    resultEl.innerHTML = `<div class="banner success">Sent to ${r.studentName}'s parent/guardian (${r.status}): "${r.body}"</div>`;
    await loadNotifications();
  } catch (err) {
    resultEl.innerHTML = `<div class="banner flagged">${err.message}</div>`;
  }
});

async function loadNotifications() {
  const schoolId = document.getElementById("notifications-filter-school").value;
  const params = new URLSearchParams();
  if (schoolId) params.set("schoolId", schoolId);

  const rows = await api(`/notifications?${params.toString()}`);
  const container = document.getElementById("notifications-list");
  if (rows.length === 0) {
    container.innerHTML = "<p>No notifications sent yet.</p>";
    return;
  }
  container.innerHTML = `
    <table>
      <thead><tr><th>Sent</th><th>Student</th><th>School</th><th>Type</th><th>Status</th><th>Message</th></tr></thead>
      <tbody>
        ${rows
          .slice(0, 50)
          .map(
            (n) => `<tr>
          <td>${new Date(n.sentAt + "Z").toLocaleString()}</td>
          <td>${n.studentName}</td>
          <td>${n.schoolName}</td>
          <td>${n.messageType.replace("_", " ")}</td>
          <td>${statusBadge2(n.status, ["sent", "simulated"])}</td>
          <td>${n.body}</td>
        </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

document.getElementById("refresh-notifications").addEventListener("click", loadNotifications);
document.getElementById("notifications-filter-school").addEventListener("change", loadNotifications);

// ---------- Video classes ----------

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

document.getElementById("expert-register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const resultEl = document.getElementById("expert-register-result");
  try {
    await api("/experts/register", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("expert-name").value,
        subject: document.getElementById("expert-subject").value,
        bio: document.getElementById("expert-bio").value || null,
      }),
    });
    resultEl.innerHTML = `<div class="banner success">Expert profile saved. You'll now see matching open requests below.</div>`;
    await loadOpenRequests();
  } catch (err) {
    resultEl.innerHTML = `<div class="banner flagged">${err.message}</div>`;
  }
});

async function loadExpertProfile() {
  const profile = await api("/experts/me");
  if (profile) {
    document.getElementById("expert-name").value = profile.name;
    document.getElementById("expert-subject").value = profile.subject;
    document.getElementById("expert-bio").value = profile.bio || "";
  }
}

document.getElementById("video-request-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const resultEl = document.getElementById("video-request-result");
  try {
    await api("/video-requests", {
      method: "POST",
      body: JSON.stringify({
        studentName: document.getElementById("video-request-student").value,
        schoolId: document.getElementById("video-request-school").value || null,
        subject: document.getElementById("video-request-subject").value,
        topic: document.getElementById("video-request-topic").value,
        preferredTime: document.getElementById("video-request-time").value || null,
      }),
    });
    resultEl.innerHTML = `<div class="banner success">Request submitted — it will appear to matching experts as an open request.</div>`;
    ["video-request-subject", "video-request-topic", "video-request-time"].forEach(
      (id) => (document.getElementById(id).value = "")
    );
    await loadOpenRequests();
    await loadMyClasses();
  } catch (err) {
    resultEl.innerHTML = `<div class="banner flagged">${err.message}</div>`;
  }
});

async function loadOpenRequests() {
  const subject = document.getElementById("open-requests-filter-subject").value;
  const params = new URLSearchParams({ status: "requested" });
  if (subject) params.set("subject", subject);

  const requests = await api(`/video-requests?${params.toString()}`);
  const container = document.getElementById("open-requests-list");
  if (requests.length === 0) {
    container.innerHTML = "<p>No open requests right now.</p>";
    return;
  }
  container.innerHTML = requests
    .map(
      (r) => `
    <div class="anomaly-card severity-medium" data-id="${r.id}">
      <div class="anomaly-top">
        <h4>${r.subject} — ${r.topic}</h4>
      </div>
      <p class="anomaly-meta">Student: ${r.studentName}${r.schoolName ? " · " + r.schoolName : ""}${r.preferredTime ? " · Preferred: " + r.preferredTime : ""} · Requested by ${r.requestedBy}</p>
      <div class="anomaly-actions">
        <button class="btn-secondary" data-action="accept-request" data-id="${r.id}">Accept &amp; start class</button>
      </div>
    </div>`
    )
    .join("");
}

document.getElementById("open-requests-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='accept-request']");
  if (!btn) return;
  try {
    const request = await api(`/video-requests/${btn.dataset.id}/accept`, { method: "POST" });
    await loadOpenRequests();
    await loadMyClasses();
    await joinCall(request.id);
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("refresh-open-requests").addEventListener("click", loadOpenRequests);
document.getElementById("open-requests-filter-subject").addEventListener("input", loadOpenRequests);

async function loadMyClasses() {
  const all = await api("/video-requests");
  const mine = all.filter((r) => r.requestedBy === state.username || r.expertUsername === state.username);
  const container = document.getElementById("my-classes-list");
  if (mine.length === 0) {
    container.innerHTML = "<p>You have no requests or accepted classes yet.</p>";
    return;
  }
  container.innerHTML = mine
    .map((r) => {
      const role = r.requestedBy === state.username ? "requester" : "expert";
      const canJoin = r.status === "accepted";
      return `
    <div class="anomaly-card severity-${r.status === "completed" ? "low" : "medium"}" data-id="${r.id}">
      <div class="anomaly-top">
        <h4>${r.subject} — ${r.topic}</h4>
        <span class="badge badge-${r.status === "completed" ? "reviewed_cleared" : r.status === "accepted" ? "open" : "low"}">${r.status}</span>
      </div>
      <p class="anomaly-meta">Student: ${r.studentName} · You are the ${role}${r.expertName ? " · Expert: " + r.expertName : ""}</p>
      ${
        canJoin
          ? `<div class="anomaly-actions"><button class="btn-primary" data-action="join-call" data-id="${r.id}">Join call</button></div>`
          : ""
      }
    </div>`;
    })
    .join("");
}

document.getElementById("my-classes-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='join-call']");
  if (!btn) return;
  await joinCall(Number(btn.dataset.id));
});

document.getElementById("refresh-my-classes").addEventListener("click", loadMyClasses);

// ---------- WebRTC call session ----------

let callSession = null;

async function joinCall(requestId) {
  const request = await api(`/video-requests/${requestId}`);
  if (request.status !== "accepted" && request.status !== "completed") {
    alert("This class has not been accepted yet.");
    return;
  }
  const role = request.requestedBy === state.username ? "caller" : "callee";

  const panel = document.getElementById("video-call-panel");
  const statusEl = document.getElementById("video-call-status");
  panel.hidden = false;
  document.getElementById("video-call-title").textContent = `${request.subject} — ${request.topic}`;
  statusEl.textContent = "Requesting camera/microphone access…";
  panel.scrollIntoView({ behavior: "smooth" });

  let localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    statusEl.textContent = `Could not access camera/microphone: ${err.message}. This is expected in headless or camera-less environments — see README.`;
    return;
  }

  document.getElementById("local-video").srcObject = localStream;

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.ontrack = (event) => {
    document.getElementById("remote-video").srcObject = event.streams[0];
    statusEl.textContent = "Connected.";
  };
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      api(`/video-requests/${requestId}/signals`, {
        method: "POST",
        body: JSON.stringify({ type: "ice", payload: event.candidate }),
      }).catch(() => {});
    }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") statusEl.textContent = "Connected.";
    if (pc.connectionState === "failed") statusEl.textContent = "Connection failed — likely a restrictive network with no TURN server configured (see README).";
  };

  callSession = { pc, localStream, requestId, role, lastSignalId: 0, answered: false };

  if (role === "caller") {
    statusEl.textContent = "Calling — waiting for the other participant to join…";
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await api(`/video-requests/${requestId}/signals`, {
      method: "POST",
      body: JSON.stringify({ type: "offer", payload: offer }),
    });
  } else {
    statusEl.textContent = "Waiting for the caller's offer…";
  }

  pollSignals();
}

async function pollSignals() {
  if (!callSession) return;
  const { pc, requestId } = callSession;
  try {
    const signals = await api(`/video-requests/${requestId}/signals?after=${callSession.lastSignalId}`);
    for (const signal of signals) {
      callSession.lastSignalId = Math.max(callSession.lastSignalId, signal.id);
      if (signal.type === "offer" && callSession.role === "callee" && !callSession.answered) {
        callSession.answered = true;
        await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await api(`/video-requests/${requestId}/signals`, {
          method: "POST",
          body: JSON.stringify({ type: "answer", payload: answer }),
        });
      } else if (signal.type === "answer" && callSession.role === "caller") {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
      } else if (signal.type === "ice") {
        await pc.addIceCandidate(new RTCIceCandidate(signal.payload)).catch(() => {});
      }
    }
  } catch (err) {
    // Transient poll failure — try again next tick rather than aborting the call.
  }
  if (callSession) callSession.pollTimeout = setTimeout(pollSignals, 1000);
}

document.getElementById("end-call-btn").addEventListener("click", async () => {
  if (!callSession) return;
  const { pc, localStream, requestId, pollTimeout } = callSession;
  clearTimeout(pollTimeout);
  pc.close();
  localStream.getTracks().forEach((t) => t.stop());
  callSession = null;
  document.getElementById("video-call-panel").hidden = true;
  try {
    await api(`/video-requests/${requestId}/complete`, { method: "POST" });
  } catch (err) {
    // Already completed by the other participant — fine.
  }
  await loadMyClasses();
});

// ---------- Init ----------

if (state.token && state.username) {
  showApp();
} else {
  showLogin();
}
