# 🌲 RF/RL Boundary Survey & Revision Platform
### *Tamil Nadu Forest Department — Mobile & Desktop PWA*

An offline-first, Progressive Web App (PWA) designed for District Forest Officers (DFOs), Forest Range Officers (FROs), and Field Surveyors to review Reserved Forest (RF) and Reserved Land (RL) boundaries, verify dispute vertices with live ground GPS, insert sub-cairns (`6a`, `6b`), and capture new ground survey polygons.

---

## 🚀 Instant Vercel Deployment

Deploy this app to Vercel in less than 1 minute:

### Option 1: Via Vercel CLI (Recommended)
1. Open terminal inside this folder:
   ```bash
   cd projects/RFRL_Boundary_Survey_App
   ```
2. Run:
   ```bash
   vercel
   ```
3. Follow the prompts to publish. You will immediately receive a live public HTTPS URL (e.g. `https://tn-forest-survey.vercel.app`) that you can share with DFOs and field staff via WhatsApp or email.

### Option 2: Via GitHub & Vercel Dashboard
1. Push this directory to your GitHub repository.
2. Go to [vercel.com](https://vercel.com) and click **"Add New Project"**.
3. Select this folder as Root Directory and click **Deploy**.

---

## 🔑 Officer Roles & Default Demo Credentials

| Role | Username | Password | Permissions |
| :--- | :--- | :--- | :--- |
| **DFO** | `dfo_cbe` | `dfo@123` | View all RF/RLs in division, review revisions, export clean KML/GeoJSON |
| **Forest Range Officer** | `fro_boluvampatti` | `fro@123` | Range-level vertex verification, flag dispute cairns |
| **Field Surveyor** | `surveyor_cbe` | `field@123` | Ground standing GPS capture, drag/shift vertices, add new polygons |

---

## 📱 Offline PWA Capabilities
- **Install on Android / iPhone**: Open the Vercel link in Chrome or Safari, tap **"Add to Home Screen"**. It installs with the Tamil Nadu Forest Department logo as a native app.
- **Works with Zero Network**: All captured points and polygons are preserved in IndexedDB on the phone. When back at the range station, tap **"Sync"** to upload.
