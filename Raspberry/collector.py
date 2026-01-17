import json
import time
import sqlite3
from typing import Any, Dict, Optional

from paho.mqtt import client as mqtt

MQTT_HOST = "127.0.0.1"   # mosquitto tourne sur le Pi
MQTT_PORT = 1883
MQTT_USER = "dashboard"
MQTT_PASS = "dashboard"
MQTT_TOPIC = "eco/sondes/+/mesures"

DB_PATH = "/home/dcrasp/dashboard/data.db"


def init_db() -> None:
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    # Mesures
    cur.execute("""
    CREATE TABLE IF NOT EXISTS measures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        sonde_id TEXT NOT NULL,
        mode TEXT,
        temp REAL,
        hum_air REAL,
        lum_raw INTEGER,
        soil_pct REAL,
        mq_raw REAL,
        topic TEXT NOT NULL
    )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_measures_ts ON measures(ts)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_measures_sonde_ts ON measures(sonde_id, ts)")

    # Alertes
    cur.execute("""
    CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        sonde_id TEXT NOT NULL,
        level TEXT NOT NULL,       -- info|warn|crit
        code TEXT NOT NULL,        -- SOIL_LOW, MQ_HIGH, SONDE_OFFLINE...
        message TEXT NOT NULL,
        value REAL,
        is_active INTEGER NOT NULL DEFAULT 1
    )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(is_active, ts)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_alerts_sonde_ts ON alerts(sonde_id, ts)")

    con.commit()
    con.close()


def safe_get(d: Dict[str, Any], k: str) -> Optional[Any]:
    return d.get(k, None)


def on_connect(client, userdata, flags, reason_code, properties=None):
    print(f"[MQTT] connected: reason_code={reason_code}")
    client.subscribe(MQTT_TOPIC)
    print(f"[MQTT] subscribed: {MQTT_TOPIC}")


def on_message(client, userdata, msg):
    ts = int(time.time())
    topic = msg.topic
    raw = msg.payload.decode("utf-8", errors="ignore")

    try:
        data = json.loads(raw)
    except Exception as e:
        print(f"[WARN] JSON parse failed: {e} | topic={topic} raw={raw[:200]}")
        return

    sonde_id = str(safe_get(data, "id") or "unknown")
    mode = safe_get(data, "mode")
    temp = safe_get(data, "temp")
    hum_air = safe_get(data, "hum_air")
    lum_raw = safe_get(data, "lum_raw")
    soil_pct = safe_get(data, "soil_pct")
    mq_raw = safe_get(data, "mq_raw")

    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("""
        INSERT INTO measures(ts, sonde_id, mode, temp, hum_air, lum_raw, soil_pct, mq_raw, topic)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (ts, sonde_id, mode, temp, hum_air, lum_raw, soil_pct, mq_raw, topic))
    con.commit()
    con.close()

    print(f"[DB] insert ok | {sonde_id} temp={temp} hum={hum_air} soil={soil_pct} lum={lum_raw} mq={mq_raw}")


def main():
    init_db()

    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    c.username_pw_set(MQTT_USER, MQTT_PASS)
    c.on_connect = on_connect
    c.on_message = on_message

    c.connect(MQTT_HOST, MQTT_PORT, 60)
    c.loop_forever()


if __name__ == "__main__":
    main()
