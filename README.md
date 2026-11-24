# Attendance System

A web-based company attendance system with camera photo capture, GPS geofencing, and face recognition — built with vanilla HTML, CSS, JavaScript, and Firebase.

## Features

- **HR Admin Dashboard**
  - Create and manage departments (add, edit, delete, assign department heads)
  - Create employee accounts with reference photo capture for face recognition
  - Edit / deactivate / delete employees; reset device binding
  - View all attendance records with filters (date, department, type)
  - Dashboard stats: total employees, present, late, absent
  - Geofence settings with interactive map (Leaflet + OpenStreetMap)
  - Flexible work hours configuration (start, end, grace period)
  - Export attendance reports to Excel and PDF

- **Employee Attendance**
  - Check-in and check-out with live camera capture
  - Experimental daily time record summary beside the check-in/out controls
  - Automatic GPS geolocation with geofence verification
  - Face recognition verification against reference photo
  - One-device-per-employee enforcement
  - Personal attendance history (last 30 records)
  - Department heads can view their department's attendance

## Tech Stack

| Layer       | Technology                                      |
| ----------- | ----------------------------------------------- |
| Frontend    | HTML, CSS, vanilla JavaScript                   |
| Backend     | Firebase (Auth, Firestore, Storage)            |
| Face recognition | face-api.js (TensorFlow.js, browser-side)  |
| Maps        | Leaflet + OpenStreetMap                         |
| Exports     | SheetJS (Excel), jsPDF (PDF)                    |

## Prerequisites

- A Google account (for Firebase)
- A Firebase project (free Spark plan is sufficient for 40+ employees)
- A browser with camera and GPS (Chrome recommended)

> **Important:** Camera and Geolocation APIs require **HTTPS** (or `localhost`). When deploying to Firebase Hosting, HTTPS is automatic. For local testing, use `localhost` (not your IP address).

## Setup Guide

### 1. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **Add Project** → give it a name → Create

### 2. Enable Firebase Services

1. **Authentication**: Build → Authentication → Get Started → Sign-in method → enable **Email/Password**
2. **Firestore Database**: Build → Firestore Database → Create Database → start in **test mode** (we'll add rules below)
3. **Storage** (optional): The app stores attendance photos as base64 in Firestore, so Firebase Storage is not required. If you prefer to use Storage for image hosting, the code can be adapted — but the default setup uses Firestore only.

### 3. Add a Web App

1. In Firebase Console → Project Settings → General → Your apps → click the web icon `</>`
2. Register the app (nickname doesn't matter)
3. Copy the `firebaseConfig` values shown

### 4. Configure the App

Open `js/firebase-config.js` and replace the placeholder values:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

### 5. Set Security Rules

**Firestore Rules**: Copy the contents of `firestore.rules` into Firebase Console → Firestore → Rules → Publish

**Storage Rules** (only if you enabled Firebase Storage): Copy the contents of `storage.rules` into Firebase Console → Storage → Rules → Publish

### 6. Create Firestore Indexes

Several queries use composite indexes. The easiest way to create them:

1. Open the app and log in as admin, then use the employee page
2. When a query needs an index, Firestore returns an error with a direct link to create it
3. Click the link and click "Create index"

Or create them manually in Firebase Console → Firestore → Indexes → Composite:

| Collection   | Fields indexed                              |
| ------------ | ------------------------------------------ |
| `attendance` | `employeeId` Asc, `timestamp` Desc         |
| `attendance` | `departmentId` Asc, `timestamp` Desc      |

### 7. Run the App

**Local development:**

Open `index.html` directly in your browser, or serve it with a local server:

```bash
# Using Python
python -m http.server 5500

# Using Node (npx)
npx serve
```

Then visit `http://localhost:5500` (or the port shown).

> Don't open the file with `file://` — camera and geolocation won't work. Use a local server or `localhost`.

**Deploy to Firebase Hosting:**

```bash
npm install -g firebase-tools
firebase login
firebase init hosting    # set "public" directory to ".", single-page app: No
firebase deploy
```

## How to Use

### First-Time Setup (HR)

1. Open the app → click **"First-time Setup"** tab
2. Create the first admin account (name, email, password)
3. You'll be redirected to the admin dashboard

### Admin Workflow

1. **Settings**: Set your office location (use the map or "Use My Location"), geofence radius, and work hours
2. **Departments**: Add departments (IT, Accounting, etc.) and optionally assign a department head
3. **Employees**: Add employees — fill in details, capture a reference photo (face must be detected)
4. **Attendance**: View and filter attendance records, export to Excel/PDF
5. **Dashboard**: See daily stats (present, late, absent)

### Employee Workflow

1. HR gives the employee their email and password
2. Employee opens the app, logs in (first login binds to their device)
3. Click **Start Camera** → camera preview appears
4. Stand within the office geofence → click **Check In**
5. The system verifies: geolocation (geofence) → face recognition → saves record
6. At end of day → click **Check Out**
7. View attendance history at the bottom of the page

## Project Structure

```
Attendance/
├── index.html              # Login + first-time admin setup
├── admin.html              # HR Admin Dashboard
├── employee.html           # Employee attendance page
├── css/
│   ├── style.css           # Shared styles (buttons, forms, modals, toasts)
│   ├── admin.css           # Admin dashboard layout (sidebar, stats, tables)
│   └── employee.css        # Employee page (camera, status, history)
├── js/
│   ├── firebase-config.js  # Firebase initialization + config
│   ├── utils.js            # Shared utilities (toast, date, distance, device ID)
│   ├── geo-utils.js        # Geolocation + geofence helpers
│   ├── face-utils.js       # Face detection, descriptor, comparison (face-api.js)
│   ├── auth.js             # Login, setup, role-based redirect
│   ├── admin.js            # Admin dashboard logic (departments, employees, attendance, settings)
│   ├── reports.js          # Excel (SheetJS) + PDF (jsPDF) export
│   └── employee.js        # Check-in/out, face verification, history
├── firestore.rules         # Firestore security rules
├── storage.rules           # Storage security rules
└── README.md               # This file
```

## Known Limitations

- **Account creation errors**: If the photo upload or Firestore write fails after the auth account is created, the auth account may remain orphaned. Delete it manually from the Firebase Console → Authentication → Users.
- **Face recognition**: Uses face-api.js with the TinyFaceDetector model — fast but less accurate than server-side solutions. Lighting and camera quality affect results. The matching threshold is 0.6 (Euclidean distance).
- **Device binding**: Stored in `localStorage` — clearing browser data will unbind the device. HR can reset the binding from the admin dashboard.
- **Model loading**: Face recognition models (~6MB total) load from a CDN on first use. This may take a few seconds on slow connections.
- **No offline support**: The app requires an internet connection for Firebase and face model loading.
```
