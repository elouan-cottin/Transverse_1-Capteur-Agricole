import sqlite3
import time
from flask import Flask, jsonify, request

DB_PATH = "/home/dcrasp/dashboard/data.db"
app = Flask(__name__)


# -----------------------------
# DB helpers
# -----------------------------
def q(sql, params=()):
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    cur.execute(sql, params)
    rows = cur.fetchall()
    con.close()
    return [dict(r) for r in rows]


def exec_sql(sql, params=()):
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute(sql, params)
    con.commit()
    con.close()


def ensure_alerts_table():
    exec_sql("""
    CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        sonde_id TEXT NOT NULL,
        level TEXT NOT NULL,
        code TEXT NOT NULL,
        message TEXT NOT NULL,
        value REAL,
        is_active INTEGER NOT NULL DEFAULT 1
    )
    """)
    exec_sql("CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(is_active, ts)")
    exec_sql("CREATE INDEX IF NOT EXISTS idx_alerts_sonde_ts ON alerts(sonde_id, ts)")


# -----------------------------
# Alerts logic
# -----------------------------
ALERT_RULES = {
    "soil_warn": 25,   # <= 25% => warn
    "soil_crit": 15,   # <= 15% => crit
    "mq_warn": 150,    # raw
    "mq_crit": 300,    # raw
    "offline_warn_s": 120,   # 2 min
    "offline_crit_s": 600,   # 10 min
}


def _set_alert(sonde_id: str, code: str, level: str, message: str, value=None):
    """Create or update an active alert (avoid duplicates)."""
    now = int(time.time())

    existing = q("""
        SELECT id FROM alerts
        WHERE sonde_id = ? AND code = ? AND is_active = 1
        ORDER BY ts DESC
        LIMIT 1
    """, (sonde_id, code))

    if existing:
        exec_sql("""
            UPDATE alerts
            SET ts = ?, level = ?, message = ?, value = ?, is_active = 1
            WHERE id = ?
        """, (now, level, message, value, existing[0]["id"]))
    else:
        exec_sql("""
            INSERT INTO alerts(ts, sonde_id, level, code, message, value, is_active)
            VALUES (?, ?, ?, ?, ?, ?, 1)
        """, (now, sonde_id, level, code, message, value))


def _clear_alert(sonde_id: str, code: str):
    """Close an alert if currently active."""
    exec_sql("""
        UPDATE alerts
        SET is_active = 0
        WHERE sonde_id = ? AND code = ? AND is_active = 1
    """, (sonde_id, code))


def evaluate_alerts_from_latest():
    """
    Compute alerts based on the latest measure of each sonde.
    Called frequently (ex: each /api/latest refresh).
    """
    ensure_alerts_table()

    # dernière mesure par sonde
    latest_rows = q("""
        SELECT m.ts, m.sonde_id, m.temp, m.hum_air, m.soil_pct, m.lum_raw, m.mq_raw
        FROM measures m
        JOIN (
            SELECT sonde_id, MAX(ts) AS ts
            FROM measures
            GROUP BY sonde_id
        ) t
        ON m.sonde_id = t.sonde_id AND m.ts = t.ts
    """)

    now = int(time.time())

    for m in latest_rows:
        sonde = m["sonde_id"]
        ts = int(m["ts"]) if m["ts"] is not None else 0

        # OFFLINE
        age = now - ts if ts else 10**9
        if age >= ALERT_RULES["offline_crit_s"]:
            _set_alert(sonde, "SONDE_OFFLINE", "crit", f"Sonde inactive depuis {age//60} min", age)
        elif age >= ALERT_RULES["offline_warn_s"]:
            _set_alert(sonde, "SONDE_OFFLINE", "warn", f"Sonde en retard ({age} s)", age)
        else:
            _clear_alert(sonde, "SONDE_OFFLINE")

        # SOIL
        soil = m.get("soil_pct", None)
        if soil is not None:
            try:
                soil_v = float(soil)
                if soil_v <= ALERT_RULES["soil_crit"]:
                    _set_alert(sonde, "SOIL_LOW", "crit", f"Sol très sec ({soil_v:.0f}%)", soil_v)
                elif soil_v <= ALERT_RULES["soil_warn"]:
                    _set_alert(sonde, "SOIL_LOW", "warn", f"Sol sec ({soil_v:.0f}%)", soil_v)
                else:
                    _clear_alert(sonde, "SOIL_LOW")
            except Exception:
                pass

        # MQ
        mq = m.get("mq_raw", None)
        if mq is not None:
            try:
                mq_v = float(mq)
                if mq_v >= ALERT_RULES["mq_crit"]:
                    _set_alert(sonde, "MQ_HIGH", "crit", f"Air dégradé (MQ={mq_v:.0f})", mq_v)
                elif mq_v >= ALERT_RULES["mq_warn"]:
                    _set_alert(sonde, "MQ_HIGH", "warn", f"Air moyen (MQ={mq_v:.0f})", mq_v)
                else:
                    _clear_alert(sonde, "MQ_HIGH")
            except Exception:
                pass


# -----------------------------
# API routes
# -----------------------------
@app.get("/api/sondes")
def sondes():
    rows = q("SELECT DISTINCT sonde_id FROM measures ORDER BY sonde_id")
    return jsonify([r["sonde_id"] for r in rows])


@app.get("/api/latest")
def latest():
    # on recalcule les alertes à chaque refresh côté dashboard
    evaluate_alerts_from_latest()

    limit = int(request.args.get("limit", "100"))
    rows = q("""
        SELECT ts, sonde_id, mode, temp, hum_air, lum_raw, soil_pct, mq_raw
        FROM measures
        ORDER BY ts DESC
        LIMIT ?
    """, (limit,))
    return jsonify(rows)


@app.get("/api/series")
def series():
    metric = request.args.get("metric", "temp")
    sonde = request.args.get("sonde", "sonde1")
    range_key = request.args.get("range", "24h")

    allowed = {"temp", "hum_air", "soil_pct", "lum_raw", "mq_raw"}
    if metric not in allowed:
        return jsonify({"error": "invalid metric"}), 400

    now = int(time.time())
    seconds = {
        "1h": 3600,
        "12h": 12 * 3600,
        "24h": 24 * 3600,
        "7d": 7 * 24 * 3600,
        "30d": 30 * 24 * 3600
    }.get(range_key, 24 * 3600)

    since = now - seconds

    rows = q(f"""
        SELECT ts, {metric} AS v
        FROM measures
        WHERE sonde_id = ? AND ts >= ? AND {metric} IS NOT NULL
        ORDER BY ts ASC
    """, (sonde, since))
    return jsonify(rows)


@app.get("/api/alerts/active")
def alerts_active():
    ensure_alerts_table()
    rows = q("""
        SELECT id, ts, sonde_id, level, code, message, value
        FROM alerts
        WHERE is_active = 1
        ORDER BY ts DESC
        LIMIT 200
    """)
    return jsonify(rows)


@app.get("/api/alerts/history")
def alerts_history():
    ensure_alerts_table()
    limit = int(request.args.get("limit", "200"))
    rows = q("""
        SELECT id, ts, sonde_id, level, code, message, value, is_active
        FROM alerts
        ORDER BY ts DESC
        LIMIT ?
    """, (limit,))
    return jsonify(rows)


@app.post("/api/alerts/ack_all")
def alerts_ack_all():
    ensure_alerts_table()
    exec_sql("UPDATE alerts SET is_active = 0 WHERE is_active = 1")
    return jsonify({"ok": True})


@app.get("/api/health")
def health():
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
