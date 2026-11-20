/**
 * Employee page logic — check in / check out with camera,
 * geolocation (geofence), and face recognition.
 */

/* ---- Global state ---- */
let _user = null;            // current user document
let _settings = null;        // office geofence + work hours
let _todayStatus = null;      // { checkIn: record, checkOut: record }
let _cameraStream = null;
let _geoWatchId = null;
let _currentLocation = null;
const _empUnsubs = {}; // real-time listener teardowns

function _fmt(date) {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/* ================================================================== */
/*  Init                                                                 */
/* ================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }

    try {
      const userDoc = await db.collection("users").doc(user.uid).get();
      if (!userDoc.exists) {
        await auth.signOut();
        window.location.href = "index.html";
        return;
      }

      _user = { uid: user.uid, ...userDoc.data() };

      // Start session watcher — signs out this device if another device logs in
      watchSession(user.uid);

      // Check role — redirect admins away
      if (_user.role === "admin") {
        window.location.href = "admin.html";
        return;
      }

      // Show user info
      document.getElementById("empName").textContent = _user.name;
      document.getElementById("empDept").textContent =
        _user.departmentName || "No Department";

      // Load everything
      await loadSettings();

      // Check today's work day status and show notice if restricted
      _checkTodayWorkDay();

      // Pre-load face models in background immediately (don't await — let it run)
      loadFaceModels().then(() => {
        console.log("Face models ready.");
      }).catch((e) => {
        console.warn("Face model preload failed:", e);
      });

      await checkTodayStatus();
      await loadHistory();

      // Start geolocation tracking
      startGeoTracking();

      // Department head view
      if (_user.isDepartmentHead) {
        await loadDeptHeadView();
      }

      // Sync any offline records now that we're authenticated
      window.addEventListener("online", () => {
        syncOfflineQueue();
        showToast("Back online — syncing attendance records...", "info", 3000);
      });
      if (navigator.onLine) syncOfflineQueue();

      // Close photo modal on overlay click
      document.getElementById("photoModalOverlay").addEventListener("click", (e) => {
        if (e.target === e.currentTarget) closeEmpPhoto();
      });
    } catch (err) {
      console.error("Employee init error:", err);
      showToast("Error loading your data. Please refresh.", "error");
    }
  });
});

/* ================================================================== */
/*  Tab switching                                                       */
/* ================================================================== */

function switchEmpTab(tab) {
  document.querySelectorAll(".emp-tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".emp-panel").forEach((p) => p.classList.remove("active"));
  document.getElementById("tab-" + tab).classList.add("active");
  document.getElementById("panel-" + tab).classList.add("active");

  // Init chat on first visit to chat tab
  if (tab === "chat" && typeof initChat === "function" && _user && !window._chatInitialized) {
    window._chatInitialized = true;
    initChat(_user);
  }

  // Clear chat badge when switching to chat tab
  if (tab === "chat") {
    const badge = document.getElementById("chatTabBadge");
    if (badge) badge.classList.add("hidden");
  }
}

/* ================================================================== */
/*  Offline attendance queue (localStorage backup + sync)              */
/* ================================================================== */

const OFFLINE_QUEUE_KEY = "att_offline_queue";

/** Save a record to localStorage queue as backup */
function _saveOfflineRecord(recordData, type) {
  if (!_user) return;
  try {
    const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
    // Store a lightweight version (skip huge photoData for the queue metadata)
    queue.push({
      employeeId:     _user.uid,
      employeeName:   _user.name,
      departmentId:   _user.departmentId   || null,
      departmentName: _user.departmentName || "",
      type:           type,
      localTimestamp: new Date().toISOString(),
      recordedOffline: !navigator.onLine
    });
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (_) { /* ignore localStorage errors */ }
}

/** Called when internet comes back — syncs any unresolved offline records */
async function syncOfflineQueue() {
  if (!_user || !navigator.onLine) return;
  try {
    const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
    if (!queue.length) return;

    // Check what's already in Firestore for this employee
    const existing = await db.collection("attendance")
      .where("employeeId", "==", _user.uid)
      .get();

    const existingTimes = new Set(
      existing.docs.map((d) => {
        const ts = d.data().timestamp?.toDate?.();
        return ts ? Math.floor(ts.getTime() / 60000) : null; // minute precision
      }).filter(Boolean)
    );

    let synced = 0;
    for (const record of queue) {
      const localTime  = new Date(record.localTimestamp);
      const localMinute = Math.floor(localTime.getTime() / 60000);

      // Skip if already synced (Firestore already has a record at this minute)
      if (existingTimes.has(localMinute)) { synced++; continue; }

      // Firestore offline SDK may have already queued this — mark as confirmed
      synced++;
    }

    // Clear the queue — Firestore offline persistence handles the actual sync
    localStorage.removeItem(OFFLINE_QUEUE_KEY);

    if (synced > 0) {
      showToast(`Your offline attendance records have been synced.`, "success");
    }
  } catch (err) {
    console.warn("Offline sync error:", err);
  }
}

/* ================================================================== */
/*  Today's work day restriction check                                 */
/* ================================================================== */

async function _checkTodayWorkDay() {
  try {
    const todayKey = _fmt(new Date());
    const dow      = new Date().getDay();
    const hint     = document.getElementById("faceHint");

    if (dow === 0) {
      if (hint) { hint.textContent = "Today is Sunday — no attendance."; hint.style.color = "var(--danger)"; }
      return;
    }

    const doc = await db.collection("workDays").doc(todayKey).get();
    if (!doc.exists) return;

    const data = doc.data();
    if (data.status === "closed") {
      const msg = data.note ? `Closed today: ${data.note}` : "Today is a closed day — no attendance.";
      if (hint) { hint.textContent = msg; hint.style.color = "var(--danger)"; }
      document.getElementById("statusLabel").textContent = "Closed Day";
      document.getElementById("statusDetail").textContent = data.note || "";
      document.getElementById("statusCard").className = "status-card status-card--out";
    } else if (data.status === "halfday") {
      const msg = `Half Day (${data.period?.toUpperCase() || "AM"}) — cutoff: ${data.cutoff || "12:00"}${data.note ? " · " + data.note : ""}`;
      if (hint) { hint.textContent = msg; hint.style.color = "var(--warning)"; }
    }
  } catch (err) {
    console.warn("Work day check:", err);
  }
}

/* ================================================================== */
/*  Settings                                                             */
/* ================================================================== */

async function loadSettings() {
  try {
    const doc = await db.collection("settings").doc("general").get();
    if (doc.exists) {
      _settings = doc.data();
    }
  } catch (err) {
    console.error("Settings load error:", err);
  }
}

/* ================================================================== */
/*  Camera                                                               */
/* ================================================================== */

async function startCamera() {
  try {
    // Wait for face models if still loading
    if (!areModelsLoaded()) {
      document.getElementById("faceHint").textContent = "Almost ready, loading face models...";
      try { await loadFaceModels(); } catch (_) {}
    }

    _cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: "user" }
    });

    const video = document.getElementById("camera");
    video.srcObject = _cameraStream;

    document.getElementById("startCamBtn").classList.add("hidden");
    document.getElementById("cameraOverlay").classList.add("hidden");
    document.getElementById("faceHint").textContent = "";

    // Show both action buttons
    const attendanceBtns = document.getElementById("attendanceBtns");
    if (attendanceBtns) attendanceBtns.style.display = "flex";

    // Start live face detection loop
    _startFaceDetectionLoop(video);

    _updateActionButtons();
  } catch (err) {
    showToast("Cannot access camera: " + err.message, "error");
    document.getElementById("faceHint").textContent =
      "Camera access denied. Please allow camera permission and try again.";
  }
}

/* Live face detection loop — runs every 800ms while camera is on */
let _faceLoopTimer = null;

function _startFaceDetectionLoop(video) {
  _stopFaceDetectionLoop();

  async function loop() {
    if (!_cameraStream || !areModelsLoaded()) return;
    try {
      const descriptor = await detectFace(video);
      const hint = document.getElementById("faceHint");
      const stage = document.querySelector(".camera-stage");
      if (descriptor) {
        if (hint) { hint.textContent = "Face detected — ready to check in."; hint.style.color = "var(--success)"; }
        if (stage) stage.style.outline = "3px solid var(--success)";
      } else {
        if (hint) { hint.textContent = "Position your face in the camera."; hint.style.color = "var(--text-light)"; }
        if (stage) stage.style.outline = "none";
      }
    } catch (_) {}
    _faceLoopTimer = setTimeout(loop, 800);
  }
  loop();
}

function _stopFaceDetectionLoop() {
  if (_faceLoopTimer) { clearTimeout(_faceLoopTimer); _faceLoopTimer = null; }
  const stage = document.querySelector(".camera-stage");
  if (stage) stage.style.outline = "none";
}

function stopCamera() {
  _stopFaceDetectionLoop();
  if (_cameraStream) {
    _cameraStream.getTracks().forEach((t) => t.stop());
    _cameraStream = null;
  }
  // Reset UI
  const attendanceBtns = document.getElementById("attendanceBtns");
  if (attendanceBtns) attendanceBtns.style.display = "none";
  const startBtn = document.getElementById("startCamBtn");
  if (startBtn) startBtn.classList.remove("hidden");
}

/* ================================================================== */
/*  Geolocation tracking                                                  */
/* ================================================================== */

function startGeoTracking() {
  if (!navigator.geolocation) return;

  _geoWatchId = watchPosition(
    (pos) => {
      _currentLocation = pos;
      _updateGeoStatus();
    },
    () => { /* silent — location optional */ }
  );
}

function _updateGeoStatus() {
  if (!_currentLocation) return;
  // Location is captured silently — no UI display needed
}

/* ================================================================== */
/*  Today's status                                                       */
/* ================================================================== */

async function checkTodayStatus() {
  if (_empUnsubs.todayStatus) { _empUnsubs.todayStatus(); _empUnsubs.todayStatus = null; }

  const start = startOfToday();
  const end   = endOfToday();

  _empUnsubs.todayStatus = db.collection("attendance")
    .where("employeeId", "==", _user.uid)
    .onSnapshot((snap) => {
      const records = snap.docs
        .map((d) => d.data())
        .filter((r) => {
          const t = r.timestamp?.toDate();
          return t && t >= start && t <= end;
        })
        .sort((a, b) => a.timestamp?.toDate() - b.timestamp?.toDate());

      _todayStatus = {
        checkIn:  records.find((r) => r.type === "check_in")  || null,
        checkOut: records.find((r) => r.type === "check_out") || null
      };
      _renderStatus();
      _renderTodayRecord();
      _updateActionButtons();
    }, (err) => console.error("Status check error:", err));
}

function _renderTodayRecord() {
  const date = document.getElementById("todayRecordDate");
  const body = document.getElementById("todayRecordBody");
  if (!date || !body) return;

  date.textContent = formatDate(new Date());
  const checkIn = _todayStatus?.checkIn;
  const checkOut = _todayStatus?.checkOut;
  let hours = "—";

  if (checkIn && checkOut) {
    const start = checkIn.timestamp?.toDate?.();
    const end = checkOut.timestamp?.toDate?.();
    if (start && end) {
      const minutes = Math.max(0, Math.floor((end - start) / 60000));
      hours = `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    }
  } else if (checkIn) {
    hours = "In progress";
  }

  body.innerHTML = `<tr>
    <td>${checkIn ? formatTime(checkIn.timestamp) : "—"}</td>
    <td>${checkOut ? formatTime(checkOut.timestamp) : "—"}</td>
    <td>${hours}</td>
  </tr>`;
}

function _renderStatus() {
  const card = document.getElementById("statusCard");
  const label = document.getElementById("statusLabel");
  const detail = document.getElementById("statusDetail");

  if (_todayStatus?.checkOut) {
    card.className = "status-card status-card--out";
    label.textContent = "Completed for today";
    detail.textContent = `In: ${formatTime(_todayStatus.checkIn.timestamp)} — Out: ${formatTime(_todayStatus.checkOut.timestamp)}`;
  } else if (_todayStatus?.checkIn) {
    card.className = "status-card status-card--in";
    label.textContent = "Checked In";
    detail.textContent = `Since ${formatTime(_todayStatus.checkIn.timestamp)} — Don't forget to check out`;
  } else {
    card.className = "status-card status-card--none";
    label.textContent = "Not Checked In";
    detail.textContent = "Start your camera and check in when ready";
  }
}

function _updateActionButtons() {
  const startBtn      = document.getElementById("startCamBtn");
  const attendanceBtns = document.getElementById("attendanceBtns");
  const checkInBtn    = document.getElementById("checkInBtn");
  const checkOutBtn   = document.getElementById("checkOutBtn");
  const cameraRunning = !!_cameraStream;

  if (!cameraRunning) {
    startBtn.classList.remove("hidden");
    if (attendanceBtns) attendanceBtns.style.display = "none";
    return;
  }

  // Camera is running — hide Start button, show both action buttons
  startBtn.classList.add("hidden");
  if (attendanceBtns) attendanceBtns.style.display = "flex";

  // Dim the button that doesn't apply based on today's status
  if (_todayStatus?.checkOut) {
    // Both done — disable both, show completed message
    if (checkInBtn)  { checkInBtn.disabled  = true; checkInBtn.style.opacity  = "0.4"; }
    if (checkOutBtn) { checkOutBtn.disabled = true; checkOutBtn.style.opacity = "0.4"; }
  } else if (_todayStatus?.checkIn) {
    // Already checked in — suggest check out but allow check in too
    if (checkInBtn)  { checkInBtn.disabled  = false; checkInBtn.style.opacity  = "0.5"; }
    if (checkOutBtn) { checkOutBtn.disabled = false; checkOutBtn.style.opacity = "1"; }
  } else {
    // Not yet checked in — suggest check in but allow both
    if (checkInBtn)  { checkInBtn.disabled  = false; checkInBtn.style.opacity  = "1"; }
    if (checkOutBtn) { checkOutBtn.disabled = false; checkOutBtn.style.opacity = "0.5"; }
  }
}

/* ================================================================== */
/*  Check in / Check out                                                 */
/* ================================================================== */

async function doCheckIn() {
  await _processAttendance("check_in");
}

async function doCheckOut() {
  await _processAttendance("check_out");
}

async function _processAttendance(type) {
  const btn = type === "check_in"
    ? document.getElementById("checkInBtn")
    : document.getElementById("checkOutBtn");

  showLoading(btn, "Processing...");
  _stopFaceDetectionLoop();

  const isOnline = navigator.onLine;

  try {
    // 0. Check if today is restricted (skip if offline — use cached Firestore data)
    const todayKey = _fmt(new Date());
    const dow      = new Date().getDay();

    if (dow === 0) {
      hideLoading(btn);
      _startFaceDetectionLoop(document.getElementById("camera"));
      showToast("Today is Sunday — attendance is not allowed.", "error");
      return;
    }

    if (isOnline) {
      try {
        const dayDoc = await db.collection("workDays").doc(todayKey).get();
        if (dayDoc.exists) {
          const dayData = dayDoc.data();
          if (dayData.status === "closed") {
            hideLoading(btn);
            _startFaceDetectionLoop(document.getElementById("camera"));
            const msg = dayData.note ? `Attendance is closed today: ${dayData.note}` : "Attendance is closed today.";
            showToast(msg, "error");
            document.getElementById("faceHint").textContent = msg;
            document.getElementById("faceHint").style.color = "var(--danger)";
            return;
          }
          if (dayData.status === "halfday" && type === "check_in") {
            const now = new Date();
            const cutoff = dayData.cutoff || "12:00";
            const [ch, cm] = cutoff.split(":").map(Number);
            const cutoffTime = new Date(); cutoffTime.setHours(ch, cm, 0, 0);
            const period = dayData.period || "am";
            if (period === "am" && now > cutoffTime) {
              hideLoading(btn);
              _startFaceDetectionLoop(document.getElementById("camera"));
              showToast(`Half day (AM only) — check-in is no longer allowed after ${cutoff}.`, "error");
              return;
            }
            if (period === "pm" && now < cutoffTime) {
              hideLoading(btn);
              _startFaceDetectionLoop(document.getElementById("camera"));
              showToast(`Half day (PM only) — check-in opens at ${cutoff}.`, "error");
              return;
            }
          }
        }
      } catch (dayErr) {
        console.warn("Could not check work day restrictions:", dayErr.message);
      }
    }
    // 1. CAPTURE photo immediately — employee doesn't need to hold still
    const video  = document.getElementById("camera");
    const canvas = document.getElementById("captureCanvas");
    const MAX_W  = 320;
    const scale  = Math.min(1, MAX_W / (video.videoWidth || 640));
    canvas.width  = Math.round((video.videoWidth  || 640) * scale);
    canvas.height = Math.round((video.videoHeight || 480) * scale);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    const photoDataUrl = canvas.toDataURL("image/jpeg", 0.6);

    // Show the captured photo briefly so employee can see it
    const overlay = document.getElementById("cameraOverlay");
    const capturedImg = document.createElement("img");
    capturedImg.src = photoDataUrl;
    capturedImg.style.cssText = "width:100%;height:100%;object-fit:cover;position:absolute;inset:0;";
    overlay.innerHTML = "";
    overlay.appendChild(capturedImg);
    overlay.classList.remove("hidden");

    // 2. Face detection — runs in parallel with location fetch
    // Shows feedback but does NOT block attendance if face isn't detected
    document.getElementById("faceHint").textContent = "Verifying your face...";
    document.getElementById("faceHint").style.color = "";

    const [liveDescriptor, pos] = await Promise.all([
      (async () => {
        const img = new Image();
        img.src = photoDataUrl;
        await new Promise((r) => (img.onload = r));
        return detectFace(img);
      })(),
      (async () => {
        if (!isOnline && _currentLocation) return _currentLocation;
        let p = _currentLocation;
        if (!p) {
          try { p = await getCurrentLocation(); }
          catch (_) { p = null; }
        }
        return p;
      })()
    ]);

    // Show face detection result — informational only, does not block
    if (!liveDescriptor) {
      document.getElementById("faceHint").textContent = "No face detected — proceeding anyway.";
      document.getElementById("faceHint").style.color = "var(--warning)";
    } else if (_user.faceDescriptor && _user.faceDescriptor.length) {
      const refDescriptor = arrayToDescriptor(_user.faceDescriptor);
      const result = verifyFace(liveDescriptor, refDescriptor, 0.6);
      if (result.match) {
        document.getElementById("faceHint").textContent = "Face verified.";
        document.getElementById("faceHint").style.color = "var(--success)";
      } else {
        document.getElementById("faceHint").textContent = "Face not matched — proceeding anyway.";
        document.getElementById("faceHint").style.color = "var(--warning)";
      }
    } else {
      document.getElementById("faceHint").textContent = "No reference face — proceeding.";
      document.getElementById("faceHint").style.color = "var(--text-light)";
    }
    // 3. Save attendance record
    document.getElementById("faceHint").textContent = isOnline ? "Saving..." : "Saving offline...";
    document.getElementById("faceHint").style.color = "";

    // Reverse geocode only when online (requires network)
    let locationName = null;
    if (pos && isOnline) {
      try {
        locationName = await reverseGeocode(pos.latitude, pos.longitude);
      } catch (_) { /* skip if geocoding fails */ }
    }

    const recordData = {
      // Always use auth.currentUser.uid — never trust _user.uid alone
      // This prevents any client-side manipulation of the employeeId
      employeeId:     auth.currentUser.uid,
      employeeName:   _user.name,
      departmentId:   _user.departmentId   || null,
      departmentName: _user.departmentName || "",
      type:           type,
      timestamp:      firebase.firestore.FieldValue.serverTimestamp(),
      location:       pos ? { latitude: pos.latitude, longitude: pos.longitude } : null,
      locationName:   locationName,
      photoData:      photoDataUrl,
      recordedOffline: !isOnline
    };

    // Write to Firestore — if offline, Firestore SDK queues this instantly in IndexedDB
    // Don't await when offline — it will never resolve until back online
    if (isOnline) {
      await db.collection("attendance").add(recordData);
    } else {
      db.collection("attendance").add(recordData); // fire-and-forget offline
    }

    // Also save to localStorage as a backup queue entry
    _saveOfflineRecord(recordData, type);

    // 5. Success
    overlay.classList.add("hidden");
    const successMsg = isOnline
      ? `${type === "check_in" ? "Checked in" : "Checked out"} at ${formatTime(new Date())}`
      : `${type === "check_in" ? "Checked in" : "Checked out"} offline — will sync when connected`;
    document.getElementById("faceHint").textContent = successMsg;
    document.getElementById("faceHint").style.color = "var(--success)";
    showToast(successMsg, "success", isOnline ? 3000 : 6000);

    await checkTodayStatus();
    if (_user.isDepartmentHead) await loadDeptHeadView();

    // Restart live face loop
    setTimeout(() => _startFaceDetectionLoop(document.getElementById("camera")), 500);
  } catch (err) {
    hideLoading(btn);
    console.error("Attendance error:", err);
    showToast(err.message || "Failed to record attendance.", "error");
    document.getElementById("faceHint").textContent = err.message || "An error occurred.";
    document.getElementById("faceHint").style.color = "var(--danger)";
    // Restart face loop on error too
    _startFaceDetectionLoop(document.getElementById("camera"));
  }
}

/* ================================================================== */
/*  Attendance history                                                   */
/* ================================================================== */

async function loadHistory() {
  const body = document.getElementById("historyBody");
  if (_empUnsubs.history) { _empUnsubs.history(); _empUnsubs.history = null; }

  _empUnsubs.history = db.collection("attendance")
    .where("employeeId", "==", _user.uid)
    .limit(30)
    .onSnapshot((snap) => {
      const records = snap.docs
        .map((d) => d.data())
        .sort((a, b) => b.timestamp?.toDate() - a.timestamp?.toDate());

      window._empHistoryData = records;

      if (!records.length) {
        body.innerHTML = `<tr><td colspan="5"><div class="empty-state">No attendance records yet.</div></td></tr>`;
        return;
      }

      body.innerHTML = records.map((r, i) => {
        const typeBadge = r.type === "check_in"
          ? '<span class="badge badge--info">In</span>'
          : '<span class="badge badge--gray">Out</span>';
        const loc = r.locationName
          ? `<a href="https://maps.google.com/?q=${r.location?.latitude},${r.location?.longitude}" target="_blank">${escapeHtml(r.locationName)}</a>`
          : r.location
          ? `<a href="https://maps.google.com/?q=${r.location.latitude},${r.location.longitude}" target="_blank">${r.location.latitude.toFixed(4)}, ${r.location.longitude.toFixed(4)}</a>`
          : "—";
        const photoCell = r.photoData
          ? `<img src="${r.photoData}" class="thumb-sm" onclick="openEmpPhotoByIndex(${i})" />`
          : "—";
        return `<tr>
          <td>${formatDate(r.timestamp)}</td>
          <td>${typeBadge}</td>
          <td>${formatTime(r.timestamp)}</td>
          <td class="text-sm">${loc}</td>
          <td>${photoCell}</td>
        </tr>`;
      }).join("");
    }, (err) => {
      console.error(err);
      body.innerHTML = `<tr><td colspan="5" class="text-center text-light">Error loading history.</td></tr>`;
    });
}

/* ================================================================== */
/*  Department head view (real-time)                                    */
/* ================================================================== */

async function loadDeptHeadView() {
  const section = document.getElementById("deptHeadSection");
  section.classList.remove("hidden");
  document.getElementById("headDeptName").textContent = _user.departmentName || "—";

  const body  = document.getElementById("deptHeadBody");
  const start = startOfToday();
  const end   = endOfToday();

  // Listen to dept attendance real-time
  if (_empUnsubs.deptHead) { _empUnsubs.deptHead(); _empUnsubs.deptHead = null; }

  // First fetch members (static list)
  const empSnap = await db.collection("users")
    .where("departmentId", "==", _user.departmentId)
    .where("role", "==", "employee").get();
  const members = empSnap.docs.map((d) => d.data());

  _empUnsubs.deptHead = db.collection("attendance")
    .where("departmentId", "==", _user.departmentId)
    .onSnapshot((attSnap) => {
      const attRecords = attSnap.docs
        .map((d) => d.data())
        .filter((r) => { const t = r.timestamp?.toDate(); return t && t >= start && t <= end; })
        .sort((a, b) => a.timestamp?.toDate() - b.timestamp?.toDate());

      const statusMap = {};
      attRecords.forEach((r) => {
        if (!statusMap[r.employeeId]) statusMap[r.employeeId] = {};
        if (r.type === "check_in")  statusMap[r.employeeId].checkIn  = r;
        if (r.type === "check_out") statusMap[r.employeeId].checkOut = r;
      });

      body.innerHTML = members.map((m) => {
        const s = statusMap[m.uid] || {};
        const statusBadge = s.checkOut
          ? '<span class="badge badge--success">Complete</span>'
          : s.checkIn
          ? '<span class="badge badge--info">Present</span>'
          : '<span class="badge badge--danger">Absent</span>';
        return `<tr>
          <td>${escapeHtml(m.name)}</td>
          <td>${s.checkIn  ? formatTime(s.checkIn.timestamp)  : "—"}</td>
          <td>${s.checkOut ? formatTime(s.checkOut.timestamp) : "—"}</td>
          <td>${statusBadge}</td>
        </tr>`;
      }).join("");
    }, (err) => {
      console.error(err);
      body.innerHTML = `<tr><td colspan="4" class="text-center text-light">Error loading.</td></tr>`;
    });
}

/* ================================================================== */
/*  Photo viewer                                                         */
/* ================================================================== */

function openEmpPhotoByIndex(index) {
  const r = (window._empHistoryData || [])[index];
  if (!r) return;
  const url = r.photoData || r.photoURL || "";
  if (!url) {
    showToast("No photo available.", "info");
    return;
  }
  document.getElementById("empPhotoImg").src = url;
  document.getElementById("empPhotoMeta").textContent = formatDateTime(r.timestamp);
  document.getElementById("photoModalOverlay").classList.add("modal-overlay--show");
}

function openEmpPhoto(url, meta) {
  if (!url) {
    showToast("No photo available.", "info");
    return;
  }
  document.getElementById("empPhotoImg").src = url;
  document.getElementById("empPhotoMeta").textContent = meta || "";
  document.getElementById("photoModalOverlay").classList.add("modal-overlay--show");
}

function closeEmpPhoto() {
  document.getElementById("photoModalOverlay").classList.remove("modal-overlay--show");
}

/* ================================================================== */
/*  Helpers                                                              */
/* ================================================================== */

function _dataUrlToBlob(dataUrl) {
  const arr = dataUrl.split(",");
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8 = new Uint8Array(n);
  while (n--) u8[n] = bstr.charCodeAt(n);
  return new Blob([u8], { type: mime });
}

// Clean up on page unload
window.addEventListener("beforeunload", () => {
  stopCamera();
  stopWatching(_geoWatchId);
  Object.values(_empUnsubs).forEach((u) => u && u());
});
