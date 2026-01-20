# Dashboard et Sonde – Capteur Agricole (ESP32 / Raspberry Pi)

Projet de sonde connectée permettant la collecte, le stockage, l’analyse et la visualisation de données environnementales (température, humidité de l’air, humidité du sol, luminosité, qualité de l’air).

L’architecture repose sur :
- des **sondes ESP32**
- un **broker MQTT (Mosquitto)**
- un **backend Python (collector + API Flask)**
- une **base de données SQLite**
- un **dashboard web (HTML / CSS / JavaScript + Chart.js)**

---

## Architecture globale

```

ESP32 (capteurs)
↓ MQTT (authentifié)
Mosquitto
↓
collector.py (Python)
↓
SQLite (data.db)
↓
API Flask (api.py)
↓
Nginx (proxy /api + frontend)
↓
Dashboard Web

````

---

## Installation et dépendances

### Mise à jour du système

```bash
sudo apt update && sudo apt upgrade -y
```

### Paquets requis

```bash
sudo apt install -y \
  mosquitto mosquitto-clients \
  nginx \
  python3 python3-venv python3-pip \
  sqlite3
```

---

## Environnement Python

```bash
cd /home/dcrasp/dashboard
python3 -m venv .venv
source .venv/bin/activate
pip install flask paho-mqtt
```

---

## Arborescence et fichiers importants

### Backend (Raspberry Pi – Python)
```text
/home/dcrasp/dashboard/
├── collector.py        # Collecteur MQTT → SQLite
├── api.py              # API Flask (mesures, séries, alertes)
├── data.db             # Base de données SQLite
└── .venv/              # Environnement virtuel Python
````

---

### Services systemd

```text
/etc/systemd/system/
├── mqtt-collector.service     # Service collector MQTT
└── dashboard-api.service      # Service API Flask
```

---

### Frontend (Dashboard web)

```text
/var/www/dashboard/
├── index.html          # Page principale du dashboard
├── app.js              # Logique JavaScript (API, graphiques, alertes)
├── logo.png            # Logo du projet
└── css/                # Styles CSS
    ├── 00-vars.css
    ├── 01-base.css
    ├── 02-layout.css
    ├── 03-components.css
    ├── 04-filter.css
    ├── 05-carousel.css
    ├── 06-status.css
    ├── 07-alerts.css
    ├── 08-table.css
    └── 09-charts.css
```

---

### Configuration Nginx

```text
/etc/nginx/sites-available/dashboard
```

(Nginx sert le frontend et proxy les routes `/api/*` vers l’API Flask)

---

## Services systemd

### Activation et démarrage

```bash
sudo systemctl daemon-reload

sudo systemctl enable mqtt-collector.service
sudo systemctl start mqtt-collector.service

sudo systemctl enable dashboard-api.service
sudo systemctl start dashboard-api.service
```

### Vérification

```bash
sudo systemctl status mqtt-collector.service
sudo systemctl status dashboard-api.service
```

---

## Configuration Nginx

### Activation du site

```bash
sudo ln -sf /etc/nginx/sites-available/dashboard /etc/nginx/sites-enabled/dashboard
sudo rm -f /etc/nginx/sites-enabled/default
```

### Test et rechargement

```bash
sudo nginx -t
sudo systemctl reload nginx
```
---

## Données collectées

Chaque mesure contient :

* température (`temp`)
* humidité de l’air (`hum_air`)
* humidité du sol (`soil_pct`)
* luminosité (`lum_raw`)
* qualité de l’air (`mq_raw`)
* timestamp (`ts`)
* identifiant de la sonde (`sonde_id`)
