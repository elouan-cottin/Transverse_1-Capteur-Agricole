/* ===========================
   Dashboard APP (Capteur Agri)
   + Alertes Actives / Historique
   =========================== */

const API_BASE = "/api";

// --- DOM ---
const el = (id) => document.getElementById(id);

const mqttStatus = el("mqttStatus");
const lastUpdate = el("lastUpdate");

const statusList = el("statusList");
const statusCount = el("statusCount");

const carouselTrack = el("carouselTrack");

const tableBody = el("tableBody");
const tableCount = el("tableCount");

const rangeSwitch = el("rangeSwitch");

// Alertes
const alertsBox = el("alerts");
const tabActive = el("tabActive");
const tabHistory = el("tabHistory");
const ackAllBtn = el("ackAllBtn");

// Charts (Chart.js)
let chartTemp, chartSoil, chartMQ, chartLum;

// State
let currentRange = "24h";
let selectedSondes = new Set(); // vide = toutes
let alertsMode = "active"; // "active" | "history"

// ===========================
// Utils
// ===========================
function fmtTime(ts) {
  if (!ts) return "--";
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDateTime(ts) {
  if (!ts) return "--";
  const d = new Date(ts * 1000);
  return d.toLocaleString("fr-FR");
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.json();
}

async function apiPost(path) {
  const res = await fetch(`${API_BASE}${path}`, { method: "POST" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.json();
}

// ===========================
// Charts helpers
// ===========================
function ensureChart(ctx, label, data) {
  return new Chart(ctx, {
    type: "line",
    data: {
      labels: data.map((p) => new Date(p.ts * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })),
      datasets: [{
        label,
        data: data.map((p) => p.v),
        tension: 0.2,
        pointRadius: 0,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: {
        x: { ticks: { maxTicksLimit: 6 } }
      }
    }
  });
}

function updateChart(chart, label, data) {
  const labels = data.map((p) => new Date(p.ts * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
  const values = data.map((p) => p.v);

  chart.data.labels = labels;
  chart.data.datasets[0].label = label;
  chart.data.datasets[0].data = values;
  chart.update();
}

// ===========================
// Rendering: Status (colonne gauche)
// ===========================
function renderStatus(latestRows) {
  if (!statusList || !statusCount) return;

  // dernière mesure par sonde
  const bySonde = new Map();
  for (const r of latestRows) {
    if (!bySonde.has(r.sonde_id)) bySonde.set(r.sonde_id, r);
  }

  const sondes = Array.from(bySonde.keys()).sort();
  statusCount.textContent = String(sondes.length);

  statusList.innerHTML = "";
  for (const id of sondes) {
    const r = bySonde.get(id);
    const row = document.createElement("div");
    row.className = "status-row";

    const left = document.createElement("div");
    left.className = "left";

    const idEl = document.createElement("div");
    idEl.className = "id";
    idEl.textContent = id;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `Dernière trame: ${fmtDateTime(r.ts)}`;

    left.appendChild(idEl);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.className = "sev ok";
    right.textContent = "OK";

    row.appendChild(left);
    row.appendChild(right);

    statusList.appendChild(row);
  }
}

// ===========================
// Rendering: Carousel (cartes sondes)
// ===========================
function renderCarousel(latestRows) {
  if (!carouselTrack) return;

  const bySonde = new Map();
  for (const r of latestRows) {
    if (!bySonde.has(r.sonde_id)) bySonde.set(r.sonde_id, r);
  }
  const sondes = Array.from(bySonde.keys()).sort();

  carouselTrack.innerHTML = "";

  for (const id of sondes) {
    const r = bySonde.get(id);

    const card = document.createElement("div");
    card.className = "sonde-card compact card"; // :white_check_mark: classes de ton CSS

    const head = document.createElement("div");
    head.className = "sonde-head";

    const name = document.createElement("div");
    name.className = "sonde-name";
    name.textContent = id;

    const badge = document.createElement("span");
    badge.className = "pill";
    badge.textContent = r.mode || "--";

    head.appendChild(name);
    head.appendChild(badge);

    const metrics = document.createElement("div");
    metrics.className = "metrics"; // :white_check_mark:

    const mk = (k, v) => {
      const m = document.createElement("div");
      m.className = "metric";
      m.innerHTML = `<div class="k">${k}</div><div class="v">${v ?? "--"}</div>`;
      return m;
    };

    metrics.appendChild(mk("Temp", r.temp));
    metrics.appendChild(mk("Hum air", r.hum_air));
    metrics.appendChild(mk("Soil %", r.soil_pct));
    metrics.appendChild(mk("Lum", r.lum_raw));
    metrics.appendChild(mk("MQ", r.mq_raw));
    metrics.appendChild(mk("Dernier", fmtTime(r.ts)));

    card.appendChild(head);
    card.appendChild(metrics);

    carouselTrack.appendChild(card);
  }
}

// ===========================
// Rendering: Table (dernières mesures)
// ===========================
function renderTable(latestRows) {
  if (!tableBody || !tableCount) return;

  const rows = latestRows.slice(0, 100);
  tableCount.textContent = `${rows.length} ligne(s)`;

  tableBody.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.sonde_id}</td>
      <td>${r.temp ?? ""}</td>
      <td>${r.hum_air ?? ""}</td>
      <td>${r.soil_pct ?? ""}</td>
      <td>${r.lum_raw ?? ""}</td>
      <td>${r.mq_raw ?? ""}</td>
      <td>${fmtTime(r.ts)}</td>
    `;
    tableBody.appendChild(tr);
  }
}

// ===========================
// Alertes UI
// (utilise les classes du CSS: .alert, .alert-top, .alert-title, .sev warn/bad/ok)
// ===========================
function levelToClass(level) {
  if (level === "crit") return "bad";
  if (level === "warn") return "warn";
  return "ok";
}

function levelToLabel(level) {
  if (level === "crit") return "CRIT";
  if (level === "warn") return "WARN";
  return "INFO";
}

function renderAlerts(list, mode) {
  if (!alertsBox) return;

  if (!list || list.length === 0) {
    alertsBox.innerHTML = `<div class="alert"><div class="alert-title">Aucune alerte</div><div class="alert-meta">${mode === "active" ? "Tout est OK ✅" : "Pas d'historique pour l’instant"}</div></div>`;
    return;
  }

  alertsBox.innerHTML = "";
  for (const a of list) {
    const div = document.createElement("div");
    div.className = "alert";

    const sevClass = levelToClass(a.level);
    const sevLabel = levelToLabel(a.level);

    div.innerHTML = `
      <div class="alert-top">
        <div>
          <div class="alert-title">${a.sonde_id} — ${a.message}</div>
          <div class="alert-meta">${fmtDateTime(a.ts)} • ${a.code}</div>
        </div>
        <div class="sev ${sevClass}">${sevLabel}</div>
      </div>
    `;

    alertsBox.appendChild(div);
  }
}

function setAlertsTab(mode) {
  alertsMode = mode;

  if (tabActive && tabHistory) {
    tabActive.classList.toggle("active", mode === "active");
    tabHistory.classList.toggle("active", mode === "history");
  }
}

// ===========================
// Data refresh
// ===========================
async function refreshLatestAndCharts() {
  try {
    // Si tu filtres plus tard par sondes, tu peux adapter ici.
    const latest = await apiGet("/latest?limit=200");

    // "Dernière mise à jour"
    if (lastUpdate) lastUpdate.textContent = `Dernière mise à jour : ${new Date().toLocaleString("fr-FR")}`;

    // Status / carousel / table
    renderStatus(latest);
    renderCarousel(latest);
    renderTable(latest);

    // Charts: on prend la première sonde (ou "sonde1" si dispo)
    const sondes = uniq(latest.map(r => r.sonde_id)).sort();
    const chosen = sondes.includes("sonde1") ? "sonde1" : (sondes[0] || "sonde1");

    // Fetch series pour les 4 graphes
    const [soil, temp, mq, lum] = await Promise.all([
      apiGet(`/series?sonde=${encodeURIComponent(chosen)}&metric=soil_pct&range=${encodeURIComponent(currentRange)}`),
      apiGet(`/series?sonde=${encodeURIComponent(chosen)}&metric=temp&range=${encodeURIComponent(currentRange)}`),
      apiGet(`/series?sonde=${encodeURIComponent(chosen)}&metric=mq_raw&range=${encodeURIComponent(currentRange)}`),
      apiGet(`/series?sonde=${encodeURIComponent(chosen)}&metric=lum_raw&range=${encodeURIComponent(currentRange)}`),
    ]);

    // Init/Update charts
    const cSoil = document.getElementById("chartSoil");
    const cTemp = document.getElementById("chartTemp");
    const cMQ = document.getElementById("chartMQ");
    const cLum = document.getElementById("chartLum");

    if (cSoil) {
      if (!chartSoil) chartSoil = ensureChart(cSoil, "Soil (%)", soil);
      else updateChart(chartSoil, "Soil (%)", soil);
    }
    if (cTemp) {
      if (!chartTemp) chartTemp = ensureChart(cTemp, "Temp (°C)", temp);
      else updateChart(chartTemp, "Temp (°C)", temp);
    }
    if (cMQ) {
      if (!chartMQ) chartMQ = ensureChart(cMQ, "MQ (raw)", mq);
      else updateChart(chartMQ, "MQ (raw)", mq);
    }
    if (cLum) {
      if (!chartLum) chartLum = ensureChart(cLum, "Lum (raw)", lum);
      else updateChart(chartLum, "Lum (raw)", lum);
    }

    // MQTT status (si API OK)
    if (mqttStatus) {
      mqttStatus.dataset.state = "ok";
      const label = mqttStatus.querySelector(".label");
      if (label) label.textContent = "API: disponible";
    }
  } catch (e) {
    if (mqttStatus) {
      mqttStatus.dataset.state = "bad";
      const label = mqttStatus.querySelector(".label");
      if (label) label.textContent = "API: indisponible";
    }
    // console pour debug
    console.error("[refreshLatestAndCharts] ", e);
  }
}

async function refreshAlerts() {
  try {
    let data;
    if (alertsMode === "history") {
      data = await apiGet("/alerts/history?limit=200");
    } else {
      data = await apiGet("/alerts/active");
    }
    renderAlerts(data, alertsMode);
  } catch (e) {
    console.error("[refreshAlerts] ", e);
    if (alertsBox) {
      alertsBox.innerHTML = `<div class="alert"><div class="alert-title">Erreur</div><div class="alert-meta">Impossible de charger les alertes</div></div>`;
    }
  }
}

// ===========================
// Events
// ===========================
function bindRangeSwitch() {
  if (!rangeSwitch) return;
  rangeSwitch.addEventListener("click", async (e) => {
    const btn = e.target.closest(".range-btn");
    if (!btn) return;

    const range = btn.dataset.range;
    if (!range) return;

    currentRange = range;

    // UI active button
    rangeSwitch.querySelectorAll(".range-btn").forEach(b => b.classList.toggle("active", b === btn));

    // refresh charts now
    await refreshLatestAndCharts();
  });
}

function bindAlertsUI() {
  if (tabActive) {
    tabActive.addEventListener("click", async () => {
      setAlertsTab("active");
      await refreshAlerts();
    });
  }
  if (tabHistory) {
    tabHistory.addEventListener("click", async () => {
      setAlertsTab("history");
      await refreshAlerts();
    });
  }

  if (ackAllBtn) {
    ackAllBtn.addEventListener("click", async () => {
      try {
        await apiPost("/alerts/ack_all");
        // reste sur l'onglet courant
        await refreshAlerts();
      } catch (e) {
        console.error("[ack_all] ", e);
      }
    });
  }
}

// ===========================
// Init
// ===========================
(async function init() {
  bindRangeSwitch();
  bindAlertsUI();

  // premier affichage
  await refreshLatestAndCharts();
  await refreshAlerts();

  // refresh périodique
  setInterval(refreshLatestAndCharts, 5000);
  setInterval(refreshAlerts, 5000);
})();
