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

async function bootApp() {
  await loadSchools();
  populateProvinceFilter();
  document.getElementById("submission-year").value = new Date().getFullYear();
  await loadRecentSubmissions();
  await loadAnomalies();
}

async function loadSchools() {
  state.schools = await api("/schools");
  const options = state.schools
    .map((s) => `<option value="${s.id}">${s.name} — ${s.province}</option>`)
    .join("");
  document.getElementById("submission-school").innerHTML = options;
  document.getElementById("disbursement-school").innerHTML = options;
}

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

// ---------- Init ----------

if (state.token && state.username) {
  showApp();
} else {
  showLogin();
}
