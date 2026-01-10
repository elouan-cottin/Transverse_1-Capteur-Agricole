// app.js — EcoPilot dashboard (maquette)

// -------------------------
// MOCK DATA (sondes)
// -------------------------
let MOCK_SONDES = [
    {
        id: "sonde1",
        online: true,
        temp: 24,
        hum_air: 51,
        lum_raw: 2180,
        soil_raw: 1510,
        soil_pct: 62,
        mq_raw: 1985,
        mq_base: 1260,
        mq_delta: 35,
        lastSeen: "il y a 3s",
        mqCalibrating: false,
        dhtErr: null
    },
    {
        id: "sonde2",
        online: true,
        temp: 26,
        hum_air: 46,
        lum_raw: 980,
        soil_raw: 2450,
        soil_pct: 18,
        mq_raw: 2102,
        mq_base: 1280,
        mq_delta: 92,
        lastSeen: "il y a 6s",
        mqCalibrating: false,
        dhtErr: null
    },
    {
        id: "sonde3",
        online: false,
        temp: null,
        hum_air: null,
        lum_raw: null,
        soil_raw: null,
        soil_pct: null,
        mq_raw: null,
        mq_base: -1,
        mq_delta: null,
        lastSeen: "il y a 2m",
        mqCalibrating: true,
        dhtErr: null
    }
];

// -------------------------
// MOCK ALERTES
// -------------------------
let mockAlerts = [
    {
        key: "sonde2:SOIL_LOW",
        sondeId: "sonde2",
        title: "Sol trop sec",
        details: "soil_pct = 18% (seuil < 25%)",
        severity: "bad",      // bad | warn | ok
        since: "14:22",
        state: "active"       // active | recovered | ack
    },
    {
        key: "sonde2:MQ_SPIKE",
        sondeId: "sonde2",
        title: "Variation air élevée",
        details: "mq_delta = 92 (seuil > 80)",
        severity: "warn",
        since: "14:24",
        state: "recovered"
    }
];

// sélection
let selected = new Set(); // vide => toutes
let currentTab = "active";

const $ = (id) => document.getElementById(id);

// -------------------------
// HELPERS
// -------------------------
function formatVal(v, unit = "", fallback = "--") {
    if (v === null || v === undefined) return fallback;
    return `${v}${unit}`;
}

function visibleSondes() {
    if (selected.size === 0) return MOCK_SONDES;
    return MOCK_SONDES.filter(s => selected.has(s.id));
}

function sortSondes(arr) {
    return [...arr].sort((a, b) => {
        const oa = a.online ? 0 : 1;
        const ob = b.online ? 0 : 1;
        if (oa !== ob) return oa - ob;
        return a.id.localeCompare(b.id, "fr", { numeric: true });
    });
}

function visibleSondesSorted() {
    return sortSondes(visibleSondes());
}

function updateFilterSummary() {
    const summary = $("filterSummary");
    if (!summary) return;

    if (selected.size === 0) summary.textContent = "Toutes";
    else if (selected.size === 1) summary.textContent = [...selected][0];
    else summary.textContent = `${selected.size} sélectionnées`;
}

function setLastUpdate() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const el = $("lastUpdate");
    if (el) el.textContent = `Dernière mise à jour : ${hh}:${mm}:${ss}`;
}

// -------------------------
// FILTER UI
// -------------------------
function renderFilterList() {
    const list = $("filterList");
    if (!list) return;

    list.innerHTML = "";

    for (const s of sortSondes(MOCK_SONDES)) {
        const row = document.createElement("label");
        row.className = "chk";
        row.innerHTML = `
      <input type="checkbox" data-id="${s.id}">
      <div>
        <div style="font-weight:800">${s.id}</div>
        <div class="muted">${s.online ? "en ligne" : "hors ligne"}</div>
      </div>
    `;
        list.appendChild(row);
    }

    syncFilterCheckboxes();
}

function syncFilterCheckboxes() {
    const list = $("filterList");
    if (!list) return;

    const checks = list.querySelectorAll("input[type=checkbox]");
    checks.forEach(chk => {
        const id = chk.getAttribute("data-id");
        chk.checked = selected.size === 0 ? true : selected.has(id);
    });
}

// -------------------------
// CAROUSEL RENDER
// -------------------------
function renderSondeCardHTML(s) {
    const badgeClass = s.online ? "ok" : "off";
    const badgeText = s.online ? "EN LIGNE" : "HORS LIGNE";
    const extraBadge = s.mqCalibrating ? `<span class="badge cal">MQ CALIB</span>` : "";

    const tempText = s.dhtErr ? `DHT err ${s.dhtErr}` : formatVal(s.temp, "°C");
    const humText = s.dhtErr ? "--" : formatVal(s.hum_air, "%");

    return `
    <div class="card sonde-card compact">
      <div class="sonde-head">
        <div class="sonde-name">${s.id}</div>
        <div style="display:flex; gap:8px; align-items:center">
          ${extraBadge}
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>
      </div>

      <div class="metrics">
        <div class="metric">
          <div class="k">Temp</div>
          <div class="v">${tempText}</div>
        </div>
        <div class="metric">
          <div class="k">Hum air</div>
          <div class="v">${humText}</div>
        </div>
        <div class="metric">
          <div class="k">Sol</div>
          <div class="v">${formatVal(s.soil_pct, "%")}</div>
        </div>
        <div class="metric">
          <div class="k">MQ Δ</div>
          <div class="v">${formatVal(s.mq_delta, "")}</div>
        </div>
      </div>

      <div style="margin-top:10px" class="muted">
        Dernière trame : ${s.lastSeen}
      </div>
    </div>
  `;
}

function renderCarousel() {
    const track = $("carouselTrack");
    if (!track) return;

    const items = visibleSondesSorted();
    track.innerHTML = items.map(renderSondeCardHTML).join("");
}

// -------------------------
// STATUS LIST (colonne gauche)
// -------------------------
function renderStatusList() {
    const wrap = $("statusList");
    const count = $("statusCount");
    if (!wrap) return;

    const items = visibleSondesSorted();
    if (count) count.textContent = `${items.length}`;

    wrap.innerHTML = "";

    for (const s of items) {
        const state =
            s.mqCalibrating ? "Calibration MQ" :
                s.online ? "En ligne" : "Hors ligne";

        const badgeClass =
            s.mqCalibrating ? "cal" :
                s.online ? "ok" : "off";

        const row = document.createElement("div");
        row.className = "status-row";
        row.innerHTML = `
      <div class="left">
        <div class="id">${s.id}</div>
        <div class="meta">${state} • ${s.lastSeen}</div>
      </div>
      <span class="badge ${badgeClass}">${state.toUpperCase()}</span>
    `;
        wrap.appendChild(row);
    }
}

// -------------------------
// TABLE
// -------------------------
function renderTable() {
    const body = $("tableBody");
    if (!body) return;

    body.innerHTML = "";

    const sondes = visibleSondesSorted();
    const count = $("tableCount");
    if (count) count.textContent = `${sondes.length} ligne(s)`;

    for (const s of sondes) {
        const tempText = s.dhtErr ? `DHT err ${s.dhtErr}` : formatVal(s.temp, "°C");
        const humText = s.dhtErr ? "--" : formatVal(s.hum_air, "%");

        const tr = document.createElement("tr");
        tr.innerHTML = `
      <td><strong>${s.id}</strong></td>
      <td>${tempText}</td>
      <td>${humText}</td>
      <td>${formatVal(s.soil_pct, "%")}</td>
      <td>${formatVal(s.lum_raw, "")}</td>
      <td>${formatVal(s.mq_delta, "")}</td>
      <td class="muted">${s.lastSeen}</td>
    `;
        body.appendChild(tr);
    }
}

// -------------------------
// ALERTS
// -------------------------
function renderAlerts() {
    const wrap = $("alerts");
    if (!wrap) return;

    wrap.innerHTML = "";

    const visibleIds = new Set(visibleSondesSorted().map(s => s.id));

    const filtered = mockAlerts
        .filter(a => visibleIds.has(a.sondeId))
        .filter(a => (currentTab === "active" ? a.state !== "ack" : a.state === "ack"));

    if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.style.padding = "8px 2px";
        empty.textContent = currentTab === "active" ? "Aucune alerte active." : "Aucun élément dans l’historique.";
        wrap.appendChild(empty);
        return;
    }

    for (const a of filtered) {
        const div = document.createElement("div");
        div.className = "alert";

        const sevLabel = a.severity === "bad" ? "CRITIQUE" : a.severity === "warn" ? "ATTENTION" : "INFO";
        const stateText =
            a.state === "active" ? "Active" :
                a.state === "recovered" ? "Revenue normale (non vue)" :
                    "Acquittée";

        const showAck = (currentTab === "active" && a.state !== "ack");

        div.innerHTML = `
      <div class="alert-top">
        <div>
          <div class="alert-title">${a.sondeId} — ${a.title}</div>
          <div class="alert-meta">${a.details}</div>
          <div class="alert-meta">Détectée : ${a.since} • État : ${stateText}</div>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px; align-items:flex-end">
          <span class="sev ${a.severity}">${sevLabel}</span>
          ${showAck ? `<button class="primary" data-ack="${a.key}" type="button">Vu</button>` : ``}
        </div>
      </div>
    `;

        wrap.appendChild(div);
    }

    wrap.querySelectorAll("button[data-ack]").forEach(btn => {
        btn.addEventListener("click", () => {
            const key = btn.getAttribute("data-ack");
            mockAlerts = mockAlerts.map(a => a.key === key ? { ...a, state: "ack" } : a);
            renderAlerts();
        });
    });
}

// -------------------------
// DRAG-TO-SCROLL + WHEEL (carousel)
// -------------------------
function setupDragScroll() {
    const el = document.getElementById("carousel");
    if (!el) return;

    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;

    const onDown = (e) => {
        if (e.button !== 0) return;
        isDown = true;
        el.classList.add("dragging");
        startX = e.pageX;
        scrollLeft = el.scrollLeft;

        document.body.classList.add("no-select");
    };

    const onUp = () => {
        isDown = false;
        el.classList.remove("dragging");
        document.body.classList.remove("no-select");
    };

    const onMove = (e) => {
        if (!isDown) return;
        e.preventDefault();
        const walk = (e.pageX - startX) * 1.6;
        el.scrollLeft = scrollLeft - walk;
    };

    el.addEventListener("mousedown", onDown);
    el.addEventListener("mouseup", onUp);
    el.addEventListener("mouseleave", onUp);
    el.addEventListener("mousemove", onMove);

    // Empêche drag natif (images/liens)
    el.addEventListener("dragstart", (e) => e.preventDefault());

    // molette verticale -> horizontal
    el.addEventListener("wheel", (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.preventDefault();
            el.scrollLeft += e.deltaY;
        }
    }, { passive: false });
}

// -------------------------
// GRAPHIQUES (mock) + plage
// -------------------------
const RANGE_CONFIG = {
    "1h": { points: 60, stepLabel: (i) => `${60 - i}m` },   // 60 minutes
    "12h": { points: 12, stepLabel: (i) => `${12 - i}h` },   // 12 points (1/h)
    "24h": { points: 24, stepLabel: (i) => `${24 - i}h` },   // 24 points (1/h)
    "7d": { points: 7, stepLabel: (i) => `${7 - i}j` },    // 7 jours
    "30d": { points: 30, stepLabel: (i) => `${30 - i}j` }    // 30 jours
};

let currentRange = "24h"; // défaut

function generateSeries(rangeKey, base, variance) {
    const cfg = RANGE_CONFIG[rangeKey];
    const data = [];
    for (let i = cfg.points - 1; i >= 0; i--) {
        data.push({
            t: cfg.stepLabel(i),
            v: Math.round(base + (Math.random() - 0.5) * variance)
        });
    }
    return data;
}

function getHistoryForRange(rangeKey) {
    // mock : plus la plage est longue, plus on lisse un peu
    const mul =
        rangeKey === "1h" ? 1.2 :
            rangeKey === "12h" ? 1.0 :
                rangeKey === "24h" ? 0.9 :
                    rangeKey === "7d" ? 0.7 :
                        0.6;

    return {
        soil: generateSeries(rangeKey, 45, 15 * mul),
        temp: generateSeries(rangeKey, 23, 6 * mul),
        mq: generateSeries(rangeKey, 20, 25 * mul),
        lum: generateSeries(rangeKey, 1400, 600 * mul)
    };
}

function buildLineChart(canvasEl, label, data, color) {
    if (!canvasEl || typeof Chart === "undefined") return null;

    return new Chart(canvasEl.getContext("2d"), {
        type: "line",
        data: {
            labels: data.map(d => d.t),
            datasets: [{
                label,
                data: data.map(d => d.v),
                borderColor: color,
                backgroundColor: color + "33",
                tension: 0.35,
                fill: true,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: true }
            },
            scales: {
                x: {
                    ticks: { color: "#8ea2c1", maxRotation: 0, autoSkip: true },
                    grid: { display: false }
                },
                y: {
                    ticks: { color: "#8ea2c1" },
                    grid: { color: "rgba(255,255,255,.05)" }
                }
            }
        }
    });
}

let charts = { soil: null, temp: null, mq: null, lum: null };

function initCharts() {
    const hist = getHistoryForRange(currentRange);

    charts.soil = buildLineChart(document.getElementById("chartSoil"), "Humidité sol (%)", hist.soil, "#4fd1c5");
    charts.temp = buildLineChart(document.getElementById("chartTemp"), "Température (°C)", hist.temp, "#63b3ed");
    charts.mq = buildLineChart(document.getElementById("chartMQ"), "Qualité de l’air (MQ)", hist.mq, "#f6ad55");
    charts.lum = buildLineChart(document.getElementById("chartLum"), "Luminosité", hist.lum, "#ecc94b");

    // Safety: certains layouts mettent 1 frame à se stabiliser
    setTimeout(() => {
        Object.values(charts).forEach(c => c && c.resize());
    }, 150);
}

function updateCharts(rangeKey) {
    currentRange = rangeKey;
    const hist = getHistoryForRange(rangeKey);

    const apply = (chart, series) => {
        if (!chart) return;
        chart.data.labels = series.map(d => d.t);
        chart.data.datasets[0].data = series.map(d => d.v);
        chart.update();
    };

    apply(charts.soil, hist.soil);
    apply(charts.temp, hist.temp);
    apply(charts.mq, hist.mq);
    apply(charts.lum, hist.lum);
}

function setupRangeSwitch() {
    const wrap = document.getElementById("rangeSwitch");
    if (!wrap) return;

    wrap.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-range]");
        if (!btn) return;

        const range = btn.getAttribute("data-range");

        wrap.querySelectorAll(".range-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        updateCharts(range);
    });
}

// -------------------------
// SIMULATION: nouvelle sonde
// -------------------------
function nextSondeId() {
    const nums = MOCK_SONDES
        .map(s => parseInt((s.id.match(/\d+/) || ["0"])[0], 10))
        .filter(n => !isNaN(n));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return `sonde${next}`;
}

function simulateNewSonde() {
    const id = nextSondeId();

    const newSonde = {
        id,
        online: true,
        temp: 23,
        hum_air: 50,
        lum_raw: 1400,
        soil_raw: 1900,
        soil_pct: 45,
        mq_raw: 1800,
        mq_base: -1,
        mq_delta: 0,
        lastSeen: "à l’instant",
        mqCalibrating: true,
        dhtErr: null
    };

    MOCK_SONDES.push(newSonde);

    renderFilterList();
    updateFilterSummary();
    renderAll();

    // fin calibration simulée
    setTimeout(() => {
        const s = MOCK_SONDES.find(x => x.id === id);
        if (!s) return;
        s.mqCalibrating = false;
        s.mq_base = 1275;
        s.mq_delta = 12;
        s.lastSeen = "il y a 1s";
        renderAll();
    }, 8000);
}

// -------------------------
// EVENTS (tabs / filter / ack all)
// -------------------------
function setupTabs() {
    $("tabActive").addEventListener("click", () => {
        currentTab = "active";
        $("tabActive").classList.add("active");
        $("tabHistory").classList.remove("active");
        renderAlerts();
    });

    $("tabHistory").addEventListener("click", () => {
        currentTab = "history";
        $("tabHistory").classList.add("active");
        $("tabActive").classList.remove("active");
        renderAlerts();
    });
}

function setupFilterPopover() {
    const pop = $("filterPopover");

    $("filterBtn").addEventListener("click", () => {
        const open = pop.classList.toggle("open");
        pop.setAttribute("aria-hidden", open ? "false" : "true");
        syncFilterCheckboxes();
    });

    document.addEventListener("click", (e) => {
        if (!e.target.closest(".filter")) {
            pop.classList.remove("open");
            pop.setAttribute("aria-hidden", "true");
        }
    });

    $("selectAllBtn").addEventListener("click", () => {
        selected.clear();
        syncFilterCheckboxes();
        updateFilterSummary();
    });

    $("selectNoneBtn").addEventListener("click", () => {
        $("filterList").querySelectorAll("input[type=checkbox]").forEach(chk => chk.checked = false);
    });

    $("applyFilterBtn").addEventListener("click", () => {
        const checks = $("filterList").querySelectorAll("input[type=checkbox]");
        const chosen = [...checks].filter(c => c.checked).map(c => c.getAttribute("data-id"));

        if (chosen.length === 0 || chosen.length === MOCK_SONDES.length) {
            selected.clear();
        } else {
            selected = new Set(chosen);
        }

        updateFilterSummary();
        renderAll();

        pop.classList.remove("open");
        pop.setAttribute("aria-hidden", "true");
    });
}

function setupAckAll() {
    $("ackAllBtn").addEventListener("click", () => {
        const ids = new Set(visibleSondesSorted().map(s => s.id));
        mockAlerts = mockAlerts.map(a => {
            if (ids.has(a.sondeId) && a.state !== "ack") return { ...a, state: "ack" };
            return a;
        });
        renderAlerts();
    });
}

// -------------------------
// MAIN RENDER
// -------------------------
function renderAll() {
    setLastUpdate();
    renderCarousel();
    renderStatusList();
    renderTable();
    renderAlerts();
}

// -------------------------
// INIT
// -------------------------
function init() {
    renderFilterList();
    updateFilterSummary();

    setupTabs();
    setupFilterPopover();
    setupAckAll();
    setupDragScroll();

    $("simulateAddBtn").addEventListener("click", simulateNewSonde);

    renderAll();
    initCharts();
    setupRangeSwitch();
}

init();

