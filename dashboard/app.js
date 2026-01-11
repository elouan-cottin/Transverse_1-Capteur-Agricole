/* ============================
   Dashboard app.js (EcoPilot)
   - API: /api/sondes, /api/latest, /api/series
   - MQTT est déjà collecté en DB côté Raspberry
   ============================ */

const API = {
  sondes: "/api/sondes",
  latest: (limit = 100) => `/api/latest?limit=${encodeURIComponent(limit)}`,
  series: (sonde, metric, range) =>
    `/api/series?sonde=${encodeURIComponent(sonde)}&metric=${encodeURIComponent(metric)}&range=${encodeURIComponent(range)}`
};

// --------- DOM helpers
const $ = (id) => document.getElementById(id);

function fmtTs(ts) {
  if (!ts) return "--";
  const d = new Date(ts * 1000);
  return d.toLocaleString();
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// --------- State
const state = {
  range: "24h",
  sondes: [],
  selectedSondes: new Set(),  // filtre
  primarySonde: null,         // utilisée pour les graphes
  latestRows: []
};

// --------- Elements (IDs de ton index.html)
const el = {
  mqttStatus: $("mqttStatus"),
  lastUpdate: $("lastUpdate"),

  // filtre
  filterBtn: $("filterBtn"),
  filterSummary: $("filterSummary"),
  filterPopover: $("filterPopover"),
  filterList: $("filterList"),
  applyFilterBtn: $("applyFilterBtn"),
  selectAllBtn: $("selectAllBtn"),
  selectNoneBtn: $("selectNoneBtn"),

  // UI
  statusList: $("statusList"),
  statusCount: $("statusCount"),
  carousel: $("carousel"),
  carouselTrack: $("carouselTrack"),
  tableBody: $("tableBody"),
  tableCount: $("tableCount"),

  // range
  rangeSwitch: $("rangeSwitch"),

  // charts (peuvent ne pas exister)
  chartSoil: $("chartSoil"),
  chartTemp: $("chartTemp"),
  chartMQ: $("chartMQ"),
  chartLum: $("chartLum")
};

// --------- Charts (créés seulement si canvas présent)
let charts = {
  soil: null,
  temp: null,
  mq: null,
  lum: null
};

function canvasExists(canvasEl) {
  return !!(canvasEl && canvasEl.getContext);
}

function makeLineChart(canvasEl, label) {
  if (!canvasExists(canvasEl) || typeof Chart === "undefined") return null;
  const ctx = canvasEl.getContext("2d");
  return new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label,
        data: [],
        tension: 0.25,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: true }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 6 } },
        y: { beginAtZero: false }
      }
    }
  });
}

function ensureCharts() {
  if (!charts.soil) charts.soil = makeLineChart(el.chartSoil, "Soil (%)");
  if (!charts.temp) charts.temp = makeLineChart(el.chartTemp, "Temp (°C)");
  if (!charts.mq)   charts.mq   = makeLineChart(el.chartMQ,   "MQ (raw)");
  if (!charts.lum)  charts.lum  = makeLineChart(el.chartLum,  "Lum (raw)");
}

async function apiGet(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
  return await r.json();
}

// --------- Filtre UI
function setFilterSummary() {
  if (!el.filterSummary) return;

  if (state.selectedSondes.size === 0 || state.selectedSondes.size === state.sondes.length) {
    el.filterSummary.textContent = "Toutes";
    return;
  }
  if (state.selectedSondes.size === 1) {
    el.filterSummary.textContent = [...state.selectedSondes][0];
    return;
  }
  el.filterSummary.textContent = `${state.selectedSondes.size} sélectionnées`;
}

function renderFilterList() {
  if (!el.filterList) return;
  el.filterList.innerHTML = "";

  state.sondes.forEach((sid) => {
    const row = document.createElement("label");
    row.className = "chk";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.selectedSondes.has(sid);
    input.dataset.sonde = sid;

    const span = document.createElement("span");
    span.textContent = sid;

    row.appendChild(input);
    row.appendChild(span);
    el.filterList.appendChild(row);
  });
}

function openFilter(open) {
  if (!el.filterPopover) return;
  if (open) {
    el.filterPopover.classList.add("open"); // respecte ton CSS .filter-popover.open :contentReference[oaicite:1]{index=1}
    el.filterPopover.setAttribute("aria-hidden", "false");
  } else {
    el.filterPopover.classList.remove("open");
    el.filterPopover.setAttribute("aria-hidden", "true");
  }
}

function initFilterEvents() {
  if (el.filterBtn) {
    el.filterBtn.addEventListener("click", () => {
      const isOpen = el.filterPopover && el.filterPopover.classList.contains("open");
      openFilter(!isOpen);
    });
  }

  // click dehors pour fermer
  document.addEventListener("click", (e) => {
    if (!el.filterPopover || !el.filterBtn) return;
    const inside = el.filterPopover.contains(e.target) || el.filterBtn.contains(e.target);
    if (!inside) openFilter(false);
  });

  if (el.selectAllBtn) {
    el.selectAllBtn.addEventListener("click", () => {
      state.selectedSondes = new Set(state.sondes);
      renderFilterList();
      setFilterSummary();
    });
  }

  if (el.selectNoneBtn) {
    el.selectNoneBtn.addEventListener("click", () => {
      state.selectedSondes = new Set(); // none
      renderFilterList();
      setFilterSummary();
    });
  }

  if (el.applyFilterBtn) {
    el.applyFilterBtn.addEventListener("click", () => {
      // lire les checkboxes
      const checks = el.filterList ? el.filterList.querySelectorAll("input[type=checkbox]") : [];
      const next = new Set();
      checks.forEach((c) => {
        if (c.checked) next.add(c.dataset.sonde);
      });
      // si tout est décoché, on interprète comme "toutes" (plus user-friendly)
      state.selectedSondes = next.size === 0 ? new Set(state.sondes) : next;

      // choisir la primary sonde (pour les graphes)
      if (!state.primarySonde || !state.selectedSondes.has(state.primarySonde)) {
        state.primarySonde = [...state.selectedSondes][0] || state.sondes[0] || null;
      }

      setFilterSummary();
      openFilter(false);

      // refresh UI
      renderAll();
      refreshCharts().catch(console.error);
    });
  }
}

// --------- Status / Carousel / Table
function groupLatestBySonde(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.sonde_id)) m.set(r.sonde_id, r);
  }
  return m;
}

function isSondeVisible(sondeId) {
  // si aucun filtre défini, tout visible
  if (state.selectedSondes.size === 0) return true;
  return state.selectedSondes.has(sondeId);
}

function renderStatus(rowsBySonde) {
  if (!el.statusList) return;
  el.statusList.innerHTML = "";

  const visibles = state.sondes.filter(isSondeVisible);

  if (el.statusCount) el.statusCount.textContent = String(visibles.length);

  for (const sid of visibles) {
    const r = rowsBySonde.get(sid);

    const row = document.createElement("div");
    row.className = "status-row"; // ton CSS :contentReference[oaicite:2]{index=2}

    const left = document.createElement("div");
    left.className = "left";

    const id = document.createElement("div");
    id.className = "id";
    id.textContent = sid;

    const meta = document.createElement("div");
    meta.className = "meta";
    if (r) meta.textContent = `Dernière trame: ${fmtTs(r.ts)}`;
    else meta.textContent = "Aucune donnée";

    left.appendChild(id);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.className = "pill";
    right.textContent = r ? "OK" : "—";

    row.appendChild(left);
    row.appendChild(right);

    el.statusList.appendChild(row);
  }
}

function renderCarousel(rowsBySonde) {
  if (!el.carouselTrack) return;
  el.carouselTrack.innerHTML = "";

  const visibles = state.sondes.filter(isSondeVisible);

  for (const sid of visibles) {
    const r = rowsBySonde.get(sid);

    const card = document.createElement("div");
    card.className = "sonde-card compact card"; // carousel CSS :contentReference[oaicite:3]{index=3}

    const head = document.createElement("div");
    head.className = "sonde-head";

    const name = document.createElement("div");
    name.className = "sonde-name";
    name.textContent = sid;

    const badge = document.createElement("div");
    badge.className = "pill";
    badge.textContent = r ? (r.mode || "—") : "—";

    head.appendChild(name);
    head.appendChild(badge);

    const metrics = document.createElement("div");
    metrics.className = "metrics";

    const mkMetric = (k, v) => {
      const box = document.createElement("div");
      box.className = "metric";
      const kk = document.createElement("div");
      kk.className = "k";
      kk.textContent = k;
      const vv = document.createElement("div");
      vv.className = "v";
      vv.textContent = (v === null || v === undefined) ? "—" : String(v);
      box.appendChild(kk);
      box.appendChild(vv);
      return box;
    };

    metrics.appendChild(mkMetric("Temp", r?.temp ?? null));
    metrics.appendChild(mkMetric("Hum air", r?.hum_air ?? null));
    metrics.appendChild(mkMetric("Soil %", r?.soil_pct ?? null));
    metrics.appendChild(mkMetric("Lum", r?.lum_raw ?? null));
    metrics.appendChild(mkMetric("MQ", r?.mq_raw ?? null));
    metrics.appendChild(mkMetric("Dernier", r ? new Date(r.ts * 1000).toLocaleTimeString() : "—"));

    card.appendChild(head);
    card.appendChild(metrics);

    // clic => devient la sonde principale des graphes
    card.addEventListener("click", () => {
      state.primarySonde = sid;
      refreshCharts().catch(console.error);
    });

    el.carouselTrack.appendChild(card);
  }
}

function renderTable(rows) {
  if (!el.tableBody) return;
  el.tableBody.innerHTML = "";

  // filtrer sur sondes visibles
  const filtered = rows.filter(r => isSondeVisible(r.sonde_id));

  if (el.tableCount) el.tableCount.textContent = `${filtered.length} ligne(s)`;

  for (const r of filtered) {
    const tr = document.createElement("tr");

    const td = (txt) => {
      const x = document.createElement("td");
      x.textContent = (txt === null || txt === undefined) ? "—" : String(txt);
      return x;
    };

    tr.appendChild(td(r.sonde_id));
    tr.appendChild(td(r.temp));
    tr.appendChild(td(r.hum_air));
    tr.appendChild(td(r.soil_pct));
    tr.appendChild(td(r.lum_raw));
    tr.appendChild(td(r.mq_raw));
    tr.appendChild(td(fmtTs(r.ts)));

    el.tableBody.appendChild(tr);
  }
}

// --------- Charts update
function setCardPills(rangeText) {
  // dans ton HTML, tu as des <span class="pill">24h</span> statiques.
  // Pour l’instant on ne les modifie pas (facultatif).
  // On garde simple.
}

async function refreshCharts() {
  ensureCharts();

  // Si pas de canvas, on sort sans erreur
  const hasAny = charts.soil || charts.temp || charts.mq || charts.lum;
  if (!hasAny) return;

  const sonde = state.primarySonde || state.sondes[0];
  if (!sonde) return;

  const range = state.range;

  // metrics mappés à ton API
  const reqs = [
    apiGet(API.series(sonde, "soil_pct", range)),
    apiGet(API.series(sonde, "temp", range)),
    apiGet(API.series(sonde, "mq_raw", range)),
    apiGet(API.series(sonde, "lum_raw", range))
  ];

  const [soil, temp, mq, lum] = await Promise.all(reqs);

  const apply = (chart, rows) => {
    if (!chart) return;
    const labels = rows.map(r => new Date(r.ts * 1000).toLocaleTimeString());
    const data = rows.map(r => r.v);
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.update();
  };

  apply(charts.soil, soil);
  apply(charts.temp, temp);
  apply(charts.mq, mq);
  apply(charts.lum, lum);

  if (el.lastUpdate) el.lastUpdate.textContent = `Dernière mise à jour : ${new Date().toLocaleString()}`;
}

// --------- Range switch
function initRangeSwitch() {
  if (!el.rangeSwitch) return;

  el.rangeSwitch.addEventListener("click", (e) => {
    const btn = e.target.closest(".range-btn");
    if (!btn) return;

    const range = btn.dataset.range;
    if (!range) return;

    state.range = range;

    // toggle active class (ton CSS range-btn.active :contentReference[oaicite:4]{index=4})
    el.rangeSwitch.querySelectorAll(".range-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    refreshCharts().catch(console.error);
  });
}

// --------- Carousel drag scroll
function initCarouselDrag() {
  if (!el.carousel) return;

  let isDown = false;
  let startX = 0;
  let scrollLeft = 0;

  el.carousel.addEventListener("mousedown", (e) => {
    isDown = true;
    el.carousel.classList.add("dragging");
    startX = e.pageX - el.carousel.offsetLeft;
    scrollLeft = el.carousel.scrollLeft;
  });

  window.addEventListener("mouseup", () => {
    isDown = false;
    el.carousel.classList.remove("dragging");
  });

  el.carousel.addEventListener("mouseleave", () => {
    isDown = false;
    el.carousel.classList.remove("dragging");
  });

  el.carousel.addEventListener("mousemove", (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - el.carousel.offsetLeft;
    const walk = (x - startX) * 1.4;
    el.carousel.scrollLeft = scrollLeft - walk;
  });
}

// --------- Main refresh loop
async function refreshLatest() {
  try {
    const rows = await apiGet(API.latest(200));
    state.latestRows = rows;

    // état mqtt: si on reçoit des rows, c'est "OK"
    if (el.mqttStatus) {
      el.mqttStatus.dataset.state = "ok";
      const label = el.mqttStatus.querySelector(".label");
      if (label) label.textContent = "MQTT: Connecté";
    }

    const bySonde = groupLatestBySonde(rows);
    renderStatus(bySonde);
    renderCarousel(bySonde);
    renderTable(rows);

    if (el.lastUpdate) el.lastUpdate.textContent = `Dernière mise à jour : ${new Date().toLocaleString()}`;
  } catch (err) {
    console.error(err);
    if (el.mqttStatus) {
      el.mqttStatus.dataset.state = "bad";
      const label = el.mqttStatus.querySelector(".label");
      if (label) label.textContent = "API: indisponible";
    }
  }
}

function renderAll() {
  const bySonde = groupLatestBySonde(state.latestRows);
  renderStatus(bySonde);
  renderCarousel(bySonde);
  renderTable(state.latestRows);
}

async function bootstrap() {
  // events
  initFilterEvents();
  initRangeSwitch();
  initCarouselDrag();

  // load sondes
  try {
    const sondes = await apiGet(API.sondes);
    state.sondes = Array.isArray(sondes) ? sondes : [];

    // default: toutes sélectionnées
    state.selectedSondes = new Set(state.sondes);
    state.primarySonde = state.sondes[0] || null;

    renderFilterList();
    setFilterSummary();
  } catch (e) {
    console.error("Cannot load sondes:", e);
  }

  // premier refresh + charts
  await refreshLatest();
  await refreshCharts();

  // boucle refresh
  setInterval(refreshLatest, 5000);
}

document.addEventListener("DOMContentLoaded", bootstrap);
