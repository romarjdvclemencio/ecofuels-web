/**
 * Admin Dashboard logic — HR manages departments, employees,
 * attendance records, and system settings.
 */

/* ---- Global state ---- */
let _departments = [];
let _employees   = [];
let _settings    = null;
let _empCameraStream = null;
let _empFaceDescriptor = null;
let _empPhotoDataUrl  = null;
let _editEmpUid = null;
let _editEmpNewPhoto = null;  // null = no change, "" = remove, dataUrl = new photo
let _adminUserData = null;

// Real-time listener unsubscribe functions
const _unsubs = {};

/* ================================================================== */
/*  Init                                                                */
/* ================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  // Date label
  document.getElementById("currentDate").textContent =
    new Date().toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    });

  // Default preset = today
  applyPreset("today");

  // Auth guard
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }

    try {
      const userDoc = await db.collection("users").doc(user.uid).get();
      if (!userDoc.exists || userDoc.data().role !== "admin") {
        window.location.href = "index.html";
        return;
      }

      // Show admin name and avatar in sidebar
      const adminData = userDoc.data();
      document.getElementById("sidebarUser").textContent =
        `${adminData.name} (${adminData.email})`;
      _setAdminAvatar(adminData);

      // Store user data for chat
      _adminUserData = { uid: user.uid, ...userDoc.data() };

      // Start session watcher — signs out if another device logs in
      watchSession(user.uid);
      // Pre-load face models in the background
      loadFaceModels().catch((e) =>
        console.warn("Face models not loaded yet:", e)
      );

      // Start real-time listeners for all data
      startRealtimeListeners();
      await initRequests();
      if (typeof initCalendar === "function") initCalendar();
    } catch (err) {
      console.error(err);
      showToast("Error loading dashboard data.", "error");
    }
  });

  // Wire up forms
  document.getElementById("deptForm").addEventListener("submit", saveDept);
  document.getElementById("empForm").addEventListener("submit", saveEmployee);
  document.getElementById("editEmpForm").addEventListener("submit", saveEditEmployee);

  // Close modals on overlay click
  _overlayClick("deptModalOverlay",     closeDeptModal);
  _overlayClick("empModalOverlay",       closeEmployeeModal);
  _overlayClick("editEmpModalOverlay",   closeEditEmpModal);
  _overlayClick("photoViewerOverlay",    closePhotoViewer);
  _overlayClick("profilePicOverlay",     closeProfilePicModal);
});

function _overlayClick(id, closeFn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", (e) => {
    if (e.target === el) closeFn();
  });
}

/* ================================================================== */
/*  Navigation                                                          */
/* ================================================================== */

const _titles = {
  dashboard:   "Dashboard",
  departments: "Departments",
  employees:   "Employees",
  attendance:  "Attendance Records",
  requests:    "Requests",
  chat:        "Chat",
  settings:    "System Settings"
};

function showSection(name) {
  document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
  document.getElementById(`section-${name}`).classList.add("active");

  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  const nav = document.querySelector(`.nav-item[data-section="${name}"]`);
  if (nav) nav.classList.add("active");

  document.getElementById("pageTitle").textContent = _titles[name] || name;

  // Close sidebar on mobile
  document.getElementById("sidebar").classList.remove("open");

  // Init chat on first visit to chat section
  if (name === "chat" && typeof initChat === "function") {
    const userDocData = _adminUserData;
    if (userDocData && !window._chatInitialized) {
      window._chatInitialized = true;
      initChat(userDocData);
    }
    // Clear badge
    const badge = document.getElementById("chatTabBadge");
    if (badge) badge.classList.add("hidden");
  }
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
}

/* ================================================================== */
/*  Real-time listeners — start all at once                           */
/* ================================================================== */

function startRealtimeListeners() {
  // Departments
  if (_unsubs.departments) _unsubs.departments();
  _unsubs.departments = db.collection("departments").orderBy("name")
    .onSnapshot((snap) => {
      _departments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderDepartments();
      populateDeptSelects();
      // Auto-create missing chat rooms
      if (typeof createDeptChatRoom === "function") {
        _departments.forEach((dept) => createDeptChatRoom(dept.id, dept.name));
      }
    }, (err) => console.error("departments listener:", err));

  // Employees
  if (_unsubs.employees) _unsubs.employees();
  _unsubs.employees = db.collection("users").where("role", "==", "employee")
    .onSnapshot((snap) => {
      _employees = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
      renderEmployees();
      renderDepartments();
    }, (err) => console.error("employees listener:", err));

  // Settings
  if (_unsubs.settings) _unsubs.settings();
  _unsubs.settings = db.collection("settings").doc("general")
    .onSnapshot((doc) => {
      if (doc.exists) {
        _settings = doc.data();
        document.getElementById("officeLat").value       = _settings.officeLat     || "";
        document.getElementById("officeLng").value       = _settings.officeLng     || "";
        document.getElementById("geofenceRadius").value  = _settings.geofenceRadius || 200;
        document.getElementById("workStart").value       = _settings.workStartTime  || "08:00";
        document.getElementById("workEnd").value         = _settings.workEndTime    || "17:00";
        document.getElementById("graceMinutes").value    = _settings.gracePeriodMinutes || 15;
      }
    }, (err) => console.error("settings listener:", err));

  // Today's attendance dashboard
  _startDashboardListener();

  // Attendance records (filtered view — re-start when filters change)
  loadAttendance();
}

function _startDashboardListener() {
  if (_unsubs.dashboard) _unsubs.dashboard();
  const start = startOfToday();
  const end   = endOfToday();

  _unsubs.dashboard = db.collection("attendance")
    .where("timestamp", ">=", start)
    .where("timestamp", "<=", end)
    .onSnapshot(() => {
      loadDashboard();
    }, (err) => console.error("dashboard listener:", err));
}

/* ================================================================== */
/*  Departments (kept for non-listener use cases)                     */
/* ================================================================== */

async function loadDepartments() {
  try {
    const snap = await db.collection("departments").orderBy("name").get();
    _departments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderDepartments();
    populateDeptSelects();
    if (typeof createDeptChatRoom === "function") {
      for (const dept of _departments) {
        await createDeptChatRoom(dept.id, dept.name);
      }
    }
  } catch (err) {
    console.error(err);
  }
}

function renderDepartments() {
  const body = document.getElementById("deptBody");

  if (!_departments.length) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty-state">
      No departments yet. Click "Add Department" to get started.
    </div></td></tr>`;
    return;
  }

  body.innerHTML = _departments
    .map((d) => {
      const empCount = _employees.filter((e) => e.departmentId === d.id).length;
      return `<tr>
        <td><strong>${escapeHtml(d.name)}</strong></td>
        <td>${escapeHtml(d.headName || "—")}</td>
        <td>${empCount}</td>
        <td>${formatDate(d.createdAt)}</td>
        <td class="flex gap-2">
          <button class="btn btn--secondary btn--sm" onclick="editDept('${d.id}')">Edit</button>
          <button class="btn btn--danger btn--sm" onclick="deleteDept('${d.id}')">Delete</button>
        </td>
      </tr>`;
    })
    .join("");
}

function populateDeptSelects() {
  const opts =
    '<option value="">— Select —</option>' +
    _departments
      .map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`)
      .join("");

  document.getElementById("empDept").innerHTML = opts;
  document.getElementById("editEmpDept").innerHTML = opts;

  // Attendance filter
  document.getElementById("attFilterDept").innerHTML =
    '<option value="">All</option>' +
    _departments
      .map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`)
      .join("");
}

/* ---- Department modal ---- */

function openDeptModal() {
  document.getElementById("deptForm").reset();
  document.getElementById("deptId").value = "";
  document.getElementById("deptModalTitle").textContent = "Add Department";

  // Populate head select with employees (no department filter — can assign anyone)
  const opts =
    '<option value="">— None —</option>' +
    _employees
      .map(
        (e) =>
          `<option value="${e.uid}">${escapeHtml(e.name)}</option>`
      )
      .join("");
  document.getElementById("deptHead").innerHTML = opts;

  _showOverlay("deptModalOverlay");
}

function closeDeptModal() {
  _hideOverlay("deptModalOverlay");
}

function editDept(id) {
  const dept = _departments.find((d) => d.id === id);
  if (!dept) return;

  document.getElementById("deptId").value = dept.id;
  document.getElementById("deptName").value = dept.name;
  document.getElementById("deptModalTitle").textContent = "Edit Department";

  const opts =
    '<option value="">— None —</option>' +
    _employees
      .map(
        (e) =>
          `<option value="${e.uid}" ${e.uid === dept.headId ? "selected" : ""}>${escapeHtml(e.name)}</option>`
      )
      .join("");
  document.getElementById("deptHead").innerHTML = opts;

  _showOverlay("deptModalOverlay");
}

async function saveDept(e) {
  e.preventDefault();
  const btn = document.getElementById("deptSaveBtn");
  const id = document.getElementById("deptId").value;
  const name = document.getElementById("deptName").value.trim();
  const headId = document.getElementById("deptHead").value;
  const headName = headId
    ? _employees.find((em) => em.uid === headId)?.name || ""
    : "";

  showLoading(btn, "Saving...");

  try {
    if (id) {
      // Update
      await db.collection("departments").doc(id).update({
        name, headId: headId || null, headName: headName || null
      });

      // Update isDepartmentHead on the employee
      // Clear previous head
      const prevDept = _departments.find((d) => d.id === id);
      if (prevDept && prevDept.headId && prevDept.headId !== headId) {
        await db.collection("users").doc(prevDept.headId).update({ isDepartmentHead: false });
      }
      if (headId) {
        await db.collection("users").doc(headId).update({ isDepartmentHead: true });
      }
      // Rename dept chat room if name changed
      if (typeof renameDeptChatRoom === "function") {
        await renameDeptChatRoom(id, name);
      }
    } else {
      // Create
      const newRef = await db.collection("departments").add({
        name,
        headId: headId || null,
        headName: headName || null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (headId) {
        await db.collection("users").doc(headId).update({ isDepartmentHead: true });
      }
      // Auto-create department chat room
      if (typeof createDeptChatRoom === "function") {
        await createDeptChatRoom(newRef.id, name);
      }
    }

    showToast("Department saved.", "success");
    closeDeptModal();
    await loadDepartments();
    await loadEmployees();
    await loadDashboard();
  } catch (err) {
    showToast(err.message || "Failed to save department.", "error");
  } finally {
    hideLoading(btn);
  }
}

async function deleteDept(id) {
  const empCount = _employees.filter((e) => e.departmentId === id).length;
  if (empCount > 0) {
    showToast(`Cannot delete: ${empCount} employee(s) are still in this department.`, "warning");
    return;
  }

  if (!confirm("Delete this department? This cannot be undone.")) return;

  try {
    await db.collection("departments").doc(id).delete();
    // Remove department chat room
    if (typeof deleteDeptChatRoom === "function") {
      await deleteDeptChatRoom(id);
    }
    showToast("Department deleted.", "success");
    await loadDepartments();
  } catch (err) {
    showToast("Failed to delete department.", "error");
  }
}

/* ================================================================== */
/*  Employees                                                            */
/* ================================================================== */

async function loadEmployees() {
  try {
    const snap = await db.collection("users").where("role", "==", "employee").get();
    _employees = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    renderEmployees();
    renderDepartments();
  } catch (err) {
    console.error(err);
  }
}
function renderEmployees() {
  _renderEmpList();
  _renderEmpOrgChart();
}

let _currentEmpView = "org";

function switchEmpView(view) {
  _currentEmpView = view;
  document.getElementById("empOrgView").classList.toggle("hidden",  view !== "org");
  document.getElementById("empListView").classList.toggle("hidden", view !== "list");
  document.getElementById("viewOrgBtn").classList.toggle("active",  view === "org");
  document.getElementById("viewListBtn").classList.toggle("active", view === "list");
}

function _renderEmpList() {
  const body   = document.getElementById("empBody");
  const search = (document.getElementById("empSearch")?.value || "").toLowerCase();

  let list = _employees
    .filter((e) => !search ||
      e.name?.toLowerCase().includes(search) ||
      e.email?.toLowerCase().includes(search))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  if (!list.length) {
    body.innerHTML = `<tr><td colspan="7"><div class="empty-state">
      No employees found. Click "Add Employee" to get started.
    </div></td></tr>`;
    return;
  }

  body.innerHTML = list.map((e) => {
    const dept = _departments.find((d) => d.id === e.departmentId);
    const photo = e.profilePic || e.photoData || "";
    return `<tr>
      <td><img src="${photo}" class="thumb" onerror="this.style.display='none'" /></td>
      <td><strong>${escapeHtml(e.name)}</strong>${e.isDepartmentHead ? ' <span class="badge badge--info">Head</span>' : ""}</td>
      <td>${escapeHtml(e.email)}</td>
      <td>${dept ? escapeHtml(dept.name) : "—"}</td>
      <td>${e.isDepartmentHead ? "Yes" : "—"}</td>
      <td>${e.active === false ? '<span class="badge badge--danger">Inactive</span>' : '<span class="badge badge--success">Active</span>'}</td>
      <td class="flex gap-2">
        <button class="btn btn--secondary btn--sm" onclick="openEditEmpModal('${e.uid}')">Edit</button>
        <button class="btn btn--danger btn--sm" onclick="deleteEmployee('${e.uid}')">Delete</button>
      </td>
    </tr>`;
  }).join("");
}

function _renderEmpOrgChart() {
  const container = document.getElementById("empOrgChart");
  if (!container) return;

  const search = (document.getElementById("empSearch")?.value || "").toLowerCase();
  const filtered = search
    ? _employees.filter((e) =>
        e.name?.toLowerCase().includes(search) ||
        e.email?.toLowerCase().includes(search) ||
        e.departmentName?.toLowerCase().includes(search))
    : _employees;

  // Always alphabetical
  const sorted = [...filtered].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  if (!sorted.length) {
    container.innerHTML = `<div class="empty-state">No employees found.</div>`;
    return;
  }

  let html = "";

  // Group employees by department (already sorted alphabetically)
  const deptMap = {};
  const noDept  = [];

  sorted.forEach((emp) => {
    if (!emp.departmentId) { noDept.push(emp); return; }
    if (!deptMap[emp.departmentId]) deptMap[emp.departmentId] = [];
    deptMap[emp.departmentId].push(emp);
  });

  // Render each department group
  _departments.forEach((dept) => {
    const members = deptMap[dept.id];
    if (!members || !members.length) return;

    const head    = members.find((e) => e.isDepartmentHead);
    const nonHead = members.filter((e) => !e.isDepartmentHead);

    html += `<div class="org-dept-group">
      <div class="org-dept-label">${escapeHtml(dept.name)}</div>`;

    // Department head
    if (head) {
      html += `<div class="org-head-row">${_orgCard(head, true)}</div>`;
    }

    // Members
    if (nonHead.length) {
      html += `<div class="org-members-row">`;
      nonHead.forEach((m) => {
        html += `<div class="org-member-wrap">${_orgCard(m, false)}</div>`;
      });
      html += `</div>`;
    } else if (!head) {
      // No head, just show all as members
      html += `<div class="org-members-row">`;
      members.forEach((m) => {
        html += `<div class="org-member-wrap">${_orgCard(m, false)}</div>`;
      });
      html += `</div>`;
    }

    html += `</div>`;
  });

  // Employees with no department
  if (noDept.length) {
    html += `<div class="org-nodept">
      <div class="org-nodept__title">No Department</div>
      <div class="org-members-row" style="padding-top:0;">
        <style>.org-nodept .org-members-row::before{display:none}</style>`;
    noDept.forEach((m) => {
      html += `<div class="org-member-wrap" style="margin-top:0;">
        <div style="height:0"></div>${_orgCard(m, false)}</div>`;
    });
    html += `</div></div>`;
  }

  container.innerHTML = html;
}

function _orgCard(emp, isHead) {
  const photo    = emp.profilePic || emp.photoData || "";
  const initials = _empInitials(emp.name || "?");
  const inactive = emp.active === false ? "org-card--inactive" : "";
  const color    = _empAvatarColor(emp.uid);

  const avatarHtml = photo
    ? `<img src="${photo}" alt="${escapeHtml(emp.name)}" onerror="this.style.display='none';this.nextSibling.style.display='flex'" /><span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;">${escapeHtml(initials)}</span>`
    : `<span>${escapeHtml(initials)}</span>`;

  return `<div class="org-card ${isHead ? "org-card--head" : ""} ${inactive}" onclick="openEditEmpModal('${emp.uid}')">
    <div class="org-card__avatar" style="background:${photo ? "#fff" : color}">
      ${avatarHtml}
    </div>
    ${isHead ? `<div class="org-card__head-badge">Head</div>` : ""}
    <div class="org-card__name">${escapeHtml(emp.name)}</div>
    <div class="org-card__role">${escapeHtml(emp.email?.split("@")[0] || "")}</div>
    ${emp.active === false ? '<span class="badge badge--danger" style="font-size:.6rem;">Inactive</span>' : ""}
    <div class="org-card__actions" onclick="event.stopPropagation()">
      <button class="btn btn--secondary btn--sm" style="padding:4px 8px;font-size:.7rem;" onclick="openEditEmpModal('${emp.uid}')">Edit</button>
      <button class="btn btn--danger btn--sm" style="padding:4px 8px;font-size:.7rem;" onclick="deleteEmployee('${emp.uid}')">Del</button>
    </div>
  </div>`;
}

function _empInitials(name) {
  const parts = (name || "").trim().split(/\s+/);
  return parts.length === 1
    ? parts[0][0].toUpperCase()
    : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function _empAvatarColor(uid) {
  const colors = ["#16a34a","#0284c7","#7c3aed","#b45309","#dc2626","#0f766e","#0369a1","#15803d"];
  let hash = 0;
  for (let i = 0; i < (uid || "").length; i++) {
    hash = (hash << 5) - hash + uid.charCodeAt(i);
    hash |= 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

/* ---- Add employee modal (with camera + face detection) ---- */

function openEmployeeModal() {
  document.getElementById("empForm").reset();
  document.getElementById("empId").value = "";
  document.getElementById("empModalTitle").textContent = "Add Employee";
  document.getElementById("empPasswordGroup").style.display = "";
  document.getElementById("empFaceStatus").textContent = "";
  document.getElementById("empPhotoPreview").classList.add("hidden");
  _empFaceDescriptor = null;
  _empPhotoDataUrl = null;
  _stopEmpCamera();
  // Default to upload mode
  switchPhotoSource("upload");
  _showOverlay("empModalOverlay");
}

/* ---- Photo source toggle (Upload vs Camera) ---- */

function switchPhotoSource(source) {
  const uploadPanel = document.getElementById("photoUploadPanel");
  const cameraPanel = document.getElementById("photoCameraPanel");
  const uploadBtn   = document.getElementById("srcUploadBtn");
  const cameraBtn   = document.getElementById("srcCameraBtn");

  // Reset state
  _empFaceDescriptor = null;
  _empPhotoDataUrl   = null;
  document.getElementById("empPhotoPreview").classList.add("hidden");
  document.getElementById("empFaceStatus").textContent = "";

  if (source === "upload") {
    uploadPanel.classList.remove("hidden");
    cameraPanel.classList.add("hidden");
    uploadBtn.classList.add("active");
    cameraBtn.classList.remove("active");
    _stopEmpCamera();
    // Reset camera buttons
    document.getElementById("empStartCamBtn").classList.remove("hidden");
    document.getElementById("empCaptureBtn").classList.add("hidden");
    document.getElementById("empRetakeBtn").classList.add("hidden");
  } else {
    uploadPanel.classList.add("hidden");
    cameraPanel.classList.remove("hidden");
    uploadBtn.classList.remove("active");
    cameraBtn.classList.add("active");
  }
}

/* ---- Handle uploaded photo ---- */

async function handlePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById("empFaceStatus");
  const preview  = document.getElementById("empPhotoPreview");
  const dropLabel = document.getElementById("uploadDropLabel");

  statusEl.textContent = "Reading image...";
  statusEl.style.color = "";

  // Read as data URL
  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;

    // Show preview
    preview.src = dataUrl;
    preview.classList.remove("hidden");
    dropLabel.textContent = file.name;

    // Run face detection
    statusEl.textContent = "Detecting face...";
    try {
      if (!areModelsLoaded()) {
        statusEl.textContent = "Loading face recognition models...";
        await loadFaceModels();
      }
      const img = new Image();
      img.src = dataUrl;
      await new Promise((r) => (img.onload = r));

      const descriptor = await detectFace(img);
      if (!descriptor) {
        statusEl.textContent = "No face detected. Please use a clear front-facing photo.";
        statusEl.style.color = "var(--danger)";
        _empFaceDescriptor = null;
        _empPhotoDataUrl   = null;
        return;
      }

      _empFaceDescriptor = descriptor;

      // Resize & compress photo before storing — Firestore has 1MB doc limit
      // Face recognition only needs ~160px, full resolution is wasteful
      _empPhotoDataUrl = await _resizeImage(dataUrl, 160, 160);

      // Show the compressed preview
      preview.src = _empPhotoDataUrl;

      statusEl.textContent = "Face detected. Ready to save.";
      statusEl.style.color = "var(--success)";
    } catch (err) {
      statusEl.textContent = "Error detecting face: " + err.message;
      statusEl.style.color = "var(--danger)";
    }
  };
  reader.readAsDataURL(file);
}

function closeEmployeeModal() {
  _stopEmpCamera();
  _hideOverlay("empModalOverlay");
}

async function startEmpCamera() {
  try {
    // Make sure models are loaded
    if (!areModelsLoaded()) {
      document.getElementById("empFaceStatus").textContent = "Loading face recognition models...";
      await loadFaceModels();
    }

    _empCameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" }
    });
    const video = document.getElementById("empCamera");
    video.srcObject = _empCameraStream;
    document.getElementById("empStartCamBtn").classList.add("hidden");
    document.getElementById("empCaptureBtn").classList.remove("hidden");
    document.getElementById("empFaceStatus").textContent = "";
  } catch (err) {
    showToast("Cannot access camera: " + err.message, "error");
  }
}

function _stopEmpCamera() {
  if (_empCameraStream) {
    _empCameraStream.getTracks().forEach((t) => t.stop());
    _empCameraStream = null;
  }
}

async function captureEmpPhoto() {
  const video  = document.getElementById("empCamera");
  const canvas = document.getElementById("empCanvas");

  // Capture at 160px max — sufficient for face recognition, keeps Firestore doc small
  const MAX_W  = 160;
  const scale  = Math.min(1, MAX_W / (video.videoWidth || 640));
  canvas.width  = Math.round((video.videoWidth  || 640) * scale);
  canvas.height = Math.round((video.videoHeight || 480) * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  _empPhotoDataUrl = canvas.toDataURL("image/jpeg", 0.6);

  // Run face detection directly on video element (faster)
  const statusEl = document.getElementById("empFaceStatus");
  statusEl.textContent = "Detecting face...";
  statusEl.style.color = "";

  try {
    const descriptor = await detectFace(video);
    if (!descriptor) {
      statusEl.textContent = "No face detected. Please face the camera and try again.";
      statusEl.style.color = "var(--danger)";
      _empFaceDescriptor = null;
      return;
    }

    _empFaceDescriptor = descriptor;
    statusEl.textContent = "Face detected! You can save the employee now.";
    statusEl.style.color = "var(--success)";

    // Show preview
    video.classList.add("hidden");
    document.getElementById("empCaptureBtn").classList.add("hidden");
    const preview = document.getElementById("empPhotoPreview");
    preview.src = _empPhotoDataUrl;
    preview.classList.remove("hidden");
    document.getElementById("empRetakeBtn").classList.remove("hidden");
    _stopEmpCamera();
  } catch (err) {
    statusEl.textContent = "Error detecting face: " + err.message;
    statusEl.style.color = "var(--danger)";
  }
}

function retakeEmpPhoto() {
  _empFaceDescriptor = null;
  _empPhotoDataUrl = null;
  document.getElementById("empPhotoPreview").classList.add("hidden");
  document.getElementById("empRetakeBtn").classList.add("hidden");
  document.getElementById("empCamera").classList.remove("hidden");
  document.getElementById("empFaceStatus").textContent = "";
  startEmpCamera();
}

async function saveEmployee(e) {
  e.preventDefault();
  const btn = document.getElementById("empSaveBtn");

  const name = document.getElementById("empName").value.trim();
  const email = document.getElementById("empEmail").value.trim().toLowerCase();
  const password = document.getElementById("empPassword").value;
  const deptId = document.getElementById("empDept").value;

  if (!deptId) {
    showToast("Please select a department.", "warning");
    return;
  }

  if (!_empFaceDescriptor || !_empPhotoDataUrl) {
    showToast("Please capture a reference photo with a detected face.", "error");
    return;
  }

  showLoading(btn, "Creating employee...");

  try {
    const secAuth = getSecondaryAuth();
    let uid;

    try {
      // Try creating a new auth account
      const cred = await secAuth.createUserWithEmailAndPassword(email, password);
      uid = cred.user.uid;
    } catch (authErr) {
      if (authErr.code === "auth/email-already-in-use") {
        // Auth account exists — check if Firestore doc also exists
        const existing = await db.collection("users")
          .where("email", "==", email).limit(1).get();

        if (!existing.empty) {
          // Firestore doc exists too — genuine duplicate
          hideLoading(btn);
          showToast("An employee with this email already exists in the system.", "error");
          return;
        }

        // Firestore doc is missing — sign in to get UID and recreate it
        if (!password) {
          hideLoading(btn);
          showToast("Auth account exists but employee record is missing. Enter the account password to recover it.", "warning");
          return;
        }
        const cred = await secAuth.signInWithEmailAndPassword(email, password);
        uid = cred.user.uid;
        showToast("Auth account found — creating missing employee record.", "info");
      } else {
        throw authErr; // re-throw other errors
      }
    }

    const dept = _departments.find((d) => d.id === deptId);

    // Input validation before writing
    if (!name || name.length < 2 || name.length > 100) {
      hideLoading(btn); showToast("Name must be 2-100 characters.", "error"); return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      hideLoading(btn); showToast("Invalid email address.", "error"); return;
    }
    if (!deptId) {
      hideLoading(btn); showToast("Please select a department.", "error"); return;
    }

    // Guard: ensure photo fits within Firestore 1MB doc limit
    let photoToSave = _empPhotoDataUrl;
    if (photoToSave && photoToSave.length > 700000) {
      photoToSave = await _resizeImage(photoToSave, 120, 120);
    }

    // Write Firestore document (set with merge so it works for both create and recovery)
    await db.collection("users").doc(uid).set({
      uid,
      email,
      name,
      role: "employee",
      departmentId: deptId,
      departmentName: dept ? dept.name : "",
      isDepartmentHead: false,
      faceDescriptor: descriptorToArray(_empFaceDescriptor),
      photoData: photoToSave,
      deviceId: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      active: true
    }, { merge: true });

    await cleanupSecondaryAuth();

    showToast("Employee created successfully!", "success");
    closeEmployeeModal();
    await loadDashboard();
  } catch (err) {
    const msg =
      err.code === "auth/wrong-password" || err.code === "auth/invalid-credential"
        ? "Auth account exists but password is incorrect. Please enter the correct password."
        : err.code === "auth/weak-password"
        ? "Password must be at least 6 characters."
        : err.message || "Failed to create employee.";
    showToast(msg, "error");
  } finally {
    hideLoading(btn);
  }
}

/* ---- Edit employee ---- */

function openEditEmpModal(uid) {
  const emp = _employees.find((e) => e.uid === uid);
  if (!emp) return;

  _editEmpUid = uid;
  _editEmpNewPhoto = null;
  document.getElementById("editEmpId").value       = uid;
  document.getElementById("editEmpName").value     = emp.name  || "";
  document.getElementById("editEmpEmail").value    = emp.email || "";
  document.getElementById("editEmpDept").value     = emp.departmentId || "";
  document.getElementById("editEmpHead").value     = emp.isDepartmentHead ? "true" : "false";
  document.getElementById("editEmpActive").value   = emp.active === false ? "false" : "true";
  document.getElementById("editEmpDevice").textContent = emp.deviceId || "Not bound";

  // Hide password-for-email field initially
  document.getElementById("editEmpPasswordForEmailGroup").style.display = "none";
  document.getElementById("editEmpPasswordForEmail").value = "";

  // Show password field when email changes
  document.getElementById("editEmpEmail").oninput = function() {
    const changed = this.value.trim().toLowerCase() !== (emp.email || "").toLowerCase();
    document.getElementById("editEmpPasswordForEmailGroup").style.display = changed ? "" : "none";
    if (!changed) document.getElementById("editEmpPasswordForEmail").value = "";
  };

  // Load current profile photo into preview
  _renderEmpPhotoPreview(emp.photoData || emp.profilePic || "", emp.name || "?");
  document.getElementById("editEmpPhotoFile").value = "";

  _showOverlay("editEmpModalOverlay");
}

function closeEditEmpModal() {
  _hideOverlay("editEmpModalOverlay");
}

async function saveEditEmployee(e) {
  e.preventDefault();
  const btn      = document.getElementById("editEmpSaveBtn");
  const name     = document.getElementById("editEmpName").value.trim();
  const email    = document.getElementById("editEmpEmail").value.trim().toLowerCase();
  const deptId   = document.getElementById("editEmpDept").value;
  const isHead   = document.getElementById("editEmpHead").value === "true";
  const active   = document.getElementById("editEmpActive").value === "true";

  showLoading(btn, "Saving...");

  try {
    const dept    = _departments.find((d) => d.id === deptId);
    const empOld  = _employees.find((e) => e.uid === _editEmpUid);
    const emailChanged = email !== (empOld?.email || "");

    // 1. Update Firestore
    const updateData = {
      name,
      email,
      departmentId:     deptId,
      departmentName:   dept ? dept.name : "",
      isDepartmentHead: isHead,
      active
    };

    if (_editEmpNewPhoto === "") {
      updateData.profilePic = null;
    } else if (_editEmpNewPhoto) {
      const resized = await _resizeImage(_editEmpNewPhoto, 200, 200);
      updateData.profilePic = resized;
    }

    await db.collection("users").doc(_editEmpUid).update(updateData);

    // 2. Update email in Firebase Auth if it changed
    if (emailChanged) {
      const currentPassword = document.getElementById("editEmpPasswordForEmail").value;
      if (!currentPassword) {
        hideLoading(btn);
        showToast("Please enter the employee's current password to change their email.", "warning");
        document.getElementById("editEmpPasswordForEmailGroup").style.display = "";
        document.getElementById("editEmpPasswordForEmail").focus();
        return;
      }
      const updated = await _updateAuthEmail(_editEmpUid, empOld?.email || "", currentPassword, email);
      if (!updated.ok) {
        // Firestore updated but Auth failed — warn but don't block
        showToast(
          `Profile saved but login email could not be updated: ${updated.error}`,
          "warning", 8000
        );
      } else {
        showToast("Employee updated. Email changed — employee must use the new email to log in.", "success", 6000);
      }
    } else {
      showToast("Employee updated successfully.", "success");
    }

    // 3. If marked as head, update department doc
    if (isHead && deptId) {
      await db.collection("departments").doc(deptId).update({
        headId:   _editEmpUid,
        headName: name
      });
    }

    closeEditEmpModal();
  } catch (err) {
    showToast(err.message || "Failed to update employee.", "error");
  } finally {
    hideLoading(btn);
  }
}

/**
 * Update a user's email in Firebase Auth.
 * Signs in as the employee on the secondary auth instance using their
 * current credentials, then updates their email directly.
 */
async function _updateAuthEmail(uid, currentEmail, currentPassword, newEmail) {
  try {
    const secAuth = getSecondaryAuth();

    // Sign in as the employee to get their auth context
    const cred = await secAuth.signInWithEmailAndPassword(currentEmail, currentPassword);

    // Update their email
    await cred.user.updateEmail(newEmail);

    await cleanupSecondaryAuth();
    return { ok: true };
  } catch (err) {
    await cleanupSecondaryAuth();
    const readable = {
      "auth/wrong-password":        "Incorrect password.",
      "auth/invalid-credential":    "Incorrect password.",
      "auth/email-already-in-use":  "That email is already used by another account.",
      "auth/invalid-email":         "Invalid email address.",
      "auth/user-not-found":        "Auth account not found for this employee.",
      "auth/requires-recent-login": "Login session expired. The employee must log in again first.",
      "auth/too-many-requests":     "Too many attempts. Please try again later."
    };
    return { ok: false, error: readable[err.code] || err.message };
  }
}

function _renderEmpPhotoPreview(src, name) {
  const img   = document.getElementById("editEmpPhotoImg");
  const inits = document.getElementById("editEmpPhotoInitials");
  if (!img || !inits) return;
  if (src) {
    img.src = src;
    img.style.display = "block";
    inits.style.display = "none";
  } else {
    img.style.display = "none";
    inits.style.display = "";
    inits.textContent = _initials(name);
  }
}

function previewEmpPhoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    _editEmpNewPhoto = e.target.result;
    _renderEmpPhotoPreview(_editEmpNewPhoto, "");
  };
  reader.readAsDataURL(file);
}

function removeEmpPhoto() {
  _editEmpNewPhoto = ""; // empty string = remove
  _renderEmpPhotoPreview("", document.getElementById("editEmpName").value);
  document.getElementById("editEmpPhotoFile").value = "";
}

async function sendEmpPasswordReset() {
  const email = document.getElementById("editEmpEmail").value.trim();
  if (!email) {
    showToast("Please fill in the employee's email first.", "warning");
    return;
  }

  const btn = document.querySelector("#editEmpForm .btn--secondary[onclick='sendEmpPasswordReset()']");
  const origText = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = "Sending..."; }

  try {
    // actionCodeSettings makes the reset link redirect back to our app
    const actionCodeSettings = {
      url: window.location.origin + "/index.html",
      handleCodeInApp: false
    };

    await auth.sendPasswordResetEmail(email, actionCodeSettings);
    showToast(`Password reset email sent to ${email}. Ask the employee to check their spam folder if not received.`, "success", 7000);
  } catch (err) {
    const msg =
      err.code === "auth/user-not-found"
        ? `No Firebase account found for ${email}. The employee may need to be re-created.`
        : err.code === "auth/invalid-email"
        ? "Invalid email address."
        : err.code === "auth/too-many-requests"
        ? "Too many reset requests. Please wait a few minutes and try again."
        : err.message || "Failed to send reset email.";
    showToast(msg, "error", 7000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origText || "Send Password Reset Email"; }
  }
}

function resetDeviceBinding() {
  if (!confirm("Reset device binding? The employee will need to log in on their new device.")) return;
  db.collection("users")
    .doc(_editEmpUid)
    .update({ deviceId: null })
    .then(() => {
      document.getElementById("editEmpDevice").textContent = "Not bound";
      showToast("Device binding reset.", "success");
    })
    .catch(() => showToast("Failed to reset device binding.", "error"));
}

async function deleteEmployee(uid) {
  const emp = _employees.find((e) => e.uid === uid);
  if (!emp) return;

  if (!confirm(`Delete ${emp.name}? This removes their data but not their auth account. Contact Firebase support to fully remove authentication.`)) return;

  try {
    await db.collection("users").doc(uid).delete();
    showToast("Employee record deleted.", "success");
    await loadEmployees();
    await loadDashboard();
  } catch (err) {
    showToast("Failed to delete employee.", "error");
  }
}

/* ================================================================== */
/*  Dashboard stats                                                      */
/* ================================================================== */

async function loadDashboard() {
  try {
    const activeEmps = _employees.filter((e) => e.active !== false);
    document.getElementById("statTotalEmployees").textContent = activeEmps.length;

    // Get today's check-ins
    const todayStart = startOfToday();
    const todayEnd = endOfToday();

    const snap = await db
      .collection("attendance")
      .where("timestamp", ">=", todayStart)
      .where("timestamp", "<=", todayEnd)
      .get();

    const records = snap.docs.map((d) => d.data());
    const checkIns = records.filter((r) => r.type === "check_in");
    const presentIds = new Set(checkIns.map((r) => r.employeeId));

    // Late calculation
    let lateCount = 0;
    if (_settings) {
      const [sh, sm] = (_settings.workStartTime || "08:00").split(":").map(Number);
      const grace = _settings.gracePeriodMinutes || 15;
      const cutoff = new Date();
      cutoff.setHours(sh, sm + grace, 0, 0);

      lateCount = checkIns.filter((r) => {
        const t = r.timestamp.toDate();
        return t > cutoff;
      }).length;
    }

    document.getElementById("statPresent").textContent = presentIds.size;
    document.getElementById("statLate").textContent = lateCount;
    document.getElementById("statAbsent").textContent = Math.max(0, activeEmps.length - presentIds.size);

    // Today's check-in table
    const checkOuts = new Map();
    records.filter((r) => r.type === "check_out").forEach((r) => {
      checkOuts.set(r.employeeId, r);
    });

    const body = document.getElementById("todayBody");
    if (!checkIns.length) {
      body.innerHTML = `<tr><td colspan="5" class="text-center text-light">No check-ins today.</td></tr>`;
      return;
    }

    // Determine late status per employee
    const getLateStatus = (timestamp) => {
      if (!_settings) return { label: "—", cls: "badge--gray" };
      const [sh, sm] = (_settings.workStartTime || "08:00").split(":").map(Number);
      const grace = _settings.gracePeriodMinutes || 15;
      const cutoff = new Date();
      cutoff.setHours(sh, sm + grace, 0, 0);
      return timestamp.toDate() > cutoff
        ? { label: "Late", cls: "badge--warning" }
        : { label: "On Time", cls: "badge--success" };
    };

    body.innerHTML = checkIns
      .sort((a, b) => a.timestamp.toDate() - b.timestamp.toDate())
      .map((r) => {
        const out = checkOuts.get(r.employeeId);
        const status = getLateStatus(r.timestamp);
        return `<tr>
          <td><strong>${escapeHtml(r.employeeName)}</strong></td>
          <td>${escapeHtml(r.departmentName || "—")}</td>
          <td>${formatTime(r.timestamp)}</td>
          <td>${out ? formatTime(out.timestamp) : '<span class="text-light">—</span>'}</td>
          <td><span class="badge ${status.cls}">${status.label}</span></td>
        </tr>`;
      })
      .join("");
  } catch (err) {
    console.error("Dashboard error:", err);
  }
}

/* ================================================================== */
/*  Attendance records                                                   */
/* ================================================================== */

async function loadAttendance() {
  const body = document.getElementById("attBody");
  body.innerHTML = `<tr><td colspan="6" class="text-center text-light">Loading...</td></tr>`;

  // Detach previous attendance listener
  if (_unsubs.attendance) { _unsubs.attendance(); _unsubs.attendance = null; }

  try {
    const deptFilter = document.getElementById("attFilterDept").value;
    const typeFilter = document.getElementById("attFilterType").value;

    // Get date range from active preset
    const range = _getAttDateRange();
    const start = range.start;
    const end   = range.end;

    _unsubs.attendance = db.collection("attendance")
      .where("timestamp", ">=", start)
      .where("timestamp", "<=", end)
      .onSnapshot((snap) => {
        let records = snap.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .sort((a, b) => b.timestamp?.toDate() - a.timestamp?.toDate());

        if (deptFilter) records = records.filter((r) => r.departmentId === deptFilter);
        if (typeFilter) records = records.filter((r) => r.type === typeFilter);

        window._attendanceData = records;

        if (!records.length) {
          body.innerHTML = `<tr><td colspan="6"><div class="empty-state">No attendance records found.</div></td></tr>`;
          return;
        }

        body.innerHTML = records.map((r, i) => {
          const typeLabel = r.type === "check_in"
            ? '<span class="badge badge--info">Check In</span>'
            : '<span class="badge badge--gray">Check Out</span>';
          const loc = r.locationName
            ? `<a href="https://maps.google.com/?q=${r.location?.latitude},${r.location?.longitude}" target="_blank">${escapeHtml(r.locationName)}</a>`
            : r.location
            ? `<a href="https://maps.google.com/?q=${r.location.latitude},${r.location.longitude}" target="_blank">${r.location.latitude.toFixed(5)}, ${r.location.longitude.toFixed(5)}</a>`
            : "—";
          const photoCell = r.photoData
            ? `<img src="${r.photoData}" class="thumb thumb--clickable" onclick="openPhotoViewerByIndex(${i})" />`
            : "—";
          return `<tr>
            <td>${photoCell}</td>
            <td><strong>${escapeHtml(r.employeeName)}</strong></td>
            <td>${escapeHtml(r.departmentName || "—")}</td>
            <td>${typeLabel}</td>
            <td>${formatDateTime(r.timestamp)}</td>
            <td class="text-sm">${loc}</td>
          </tr>`;
        }).join("");
      }, (err) => {
        console.error(err);
        body.innerHTML = `<tr><td colspan="6" class="text-center text-light">Error loading records.</td></tr>`;
      });

  } catch (err) {
    console.error(err);
    body.innerHTML = `<tr><td colspan="6" class="text-center text-light">Error loading records.</td></tr>`;
  }
}

/* ---- Attendance date preset logic ---- */

let _activePreset = "today";

function applyPreset(preset) {
  _activePreset = preset;

  // Update button styles
  document.querySelectorAll(".att-preset").forEach((btn) => {
    btn.classList.toggle("active", btn.id === `preset-${preset}`);
  });

  // Show/hide custom range inputs
  const customRow = document.getElementById("customRangeRow");
  if (customRow) customRow.classList.toggle("hidden", preset !== "custom");

  // Pre-fill custom range with a sensible default when first opened
  if (preset === "custom") {
    const from = document.getElementById("attFilterFrom");
    const to   = document.getElementById("attFilterTo");
    if (from && !from.value) from.value = toDateInput(new Date());
    if (to   && !to.value)   to.value   = toDateInput(new Date());
  }

  loadAttendance();
}

function _getAttDateRange() {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let start, end;

  switch (_activePreset) {
    case "today":
      start = new Date(today); end = new Date(today); end.setHours(23, 59, 59, 999);
      break;

    case "yesterday": {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      start = y; end = new Date(y); end.setHours(23, 59, 59, 999);
      break;
    }

    case "week": {
      // Monday of this week
      const day = today.getDay() || 7; // treat Sunday as 7
      const mon = new Date(today); mon.setDate(today.getDate() - day + 1);
      start = mon; end = new Date(); end.setHours(23, 59, 59, 999);
      break;
    }

    case "lastweek": {
      const day   = today.getDay() || 7;
      const thisMon = new Date(today); thisMon.setDate(today.getDate() - day + 1);
      const lastMon = new Date(thisMon); lastMon.setDate(thisMon.getDate() - 7);
      const lastSun = new Date(thisMon); lastSun.setDate(thisMon.getDate() - 1); lastSun.setHours(23, 59, 59, 999);
      start = lastMon; end = lastSun;
      break;
    }

    case "month":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      break;

    case "lastmonth": {
      const lm = now.getMonth() - 1;
      const yr = lm < 0 ? now.getFullYear() - 1 : now.getFullYear();
      const mo = lm < 0 ? 11 : lm;
      start = new Date(yr, mo, 1);
      end   = new Date(yr, mo + 1, 0, 23, 59, 59, 999);
      break;
    }

    case "custom": {
      const fromVal = document.getElementById("attFilterFrom")?.value;
      const toVal   = document.getElementById("attFilterTo")?.value;
      if (fromVal) {
        const [fy, fm, fd] = fromVal.split("-").map(Number);
        start = new Date(fy, fm - 1, fd, 0, 0, 0);
      } else {
        start = new Date(2000, 0, 1);
      }
      if (toVal) {
        const [ty, tm, td] = toVal.split("-").map(Number);
        end = new Date(ty, tm - 1, td, 23, 59, 59, 999);
      } else {
        end = new Date(2100, 0, 1);
      }
      break;
    }

    default:
      start = new Date(today); end = new Date(today); end.setHours(23, 59, 59, 999);
  }

  return { start, end };
}

function resetAttFilters() {
  document.getElementById("attFilterDept").value = "";
  document.getElementById("attFilterType").value = "";
  applyPreset("today");
}

/* ---- Photo viewer ---- */

function openPhotoViewerByIndex(index) {
  const r = (window._attendanceData || [])[index];
  if (!r) return;
  const url = r.photoData || r.photoURL || "";
  if (!url) {
    showToast("No photo available.", "info");
    return;
  }
  document.getElementById("photoViewerImg").src = url;
  document.getElementById("photoViewerMeta").textContent =
    `${r.employeeName} — ${formatDateTime(r.timestamp)}`;
  _showOverlay("photoViewerOverlay");
}

function openPhotoViewer(url, name, time) {
  if (!url) {
    showToast("No photo available.", "info");
    return;
  }
  document.getElementById("photoViewerImg").src = url;
  document.getElementById("photoViewerMeta").textContent = `${name} — ${time}`;
  _showOverlay("photoViewerOverlay");
}

function closePhotoViewer() {
  _hideOverlay("photoViewerOverlay");
}

/* ================================================================== */
/*  Settings (geofence, work hours)                                     */
/* ================================================================== */
/*  Settings save / location                                           */
/* ================================================================== */

async function saveSettings() {
  const officeLat = parseFloat(document.getElementById("officeLat").value);
  const officeLng = parseFloat(document.getElementById("officeLng").value);
  const geofenceRadius = parseInt(document.getElementById("geofenceRadius").value) || 200;
  const workStartTime = document.getElementById("workStart").value || "08:00";
  const workEndTime = document.getElementById("workEnd").value || "17:00";
  const gracePeriodMinutes = parseInt(document.getElementById("graceMinutes").value) || 15;

  if (isNaN(officeLat) || isNaN(officeLng)) {
    showToast("Please set a valid office location.", "warning");
    return;
  }

  try {
    await db.collection("settings").doc("general").set({
      officeLat, officeLng, geofenceRadius,
      workStartTime, workEndTime, gracePeriodMinutes
    });

    _settings = { officeLat, officeLng, geofenceRadius, workStartTime, workEndTime, gracePeriodMinutes };

    showToast("Settings saved.", "success");
    await loadDashboard();
  } catch (err) {
    showToast("Failed to save settings.", "error");
  }
}

function useMyLocation() {
  showToast("Getting your location...", "info");
  getCurrentLocation()
    .then((pos) => {
      document.getElementById("officeLat").value = pos.latitude.toFixed(6);
      document.getElementById("officeLng").value = pos.longitude.toFixed(6);
      showToast("Location filled in. Click Save Settings to apply.", "success");
    })
    .catch((err) => showToast(err.message, "error"));
}

/* ================================================================== */
/*  Helpers                                                             */
/* ================================================================== */

function _showOverlay(id) {
  document.getElementById(id).classList.add("modal-overlay--show");
}

function _hideOverlay(id) {
  document.getElementById(id).classList.remove("modal-overlay--show");
}

/* ================================================================== */
/*  Admin Profile Picture                                              */
/* ================================================================== */

let _profilePicDataUrl = null;

/** Set the avatar in the sidebar from the user's Firestore data. */
function _setAdminAvatar(data) {
  const img      = document.getElementById("sidebarAvatarImg");
  const initials = document.getElementById("sidebarAvatarInitials");
  if (!img || !initials) return;

  if (data.profilePic) {
    img.src = data.profilePic;
    img.style.display = "block";
    initials.style.display = "none";
  } else {
    img.style.display = "none";
    initials.style.display = "";
    initials.textContent = _initials(data.name || "A");
  }
}

function _initials(name) {
  const parts = (name || "").trim().split(/\s+/);
  return parts.length === 1
    ? parts[0][0].toUpperCase()
    : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function openProfilePicModal() {
  _profilePicDataUrl = null;

  // Show current pic in modal
  const data   = _adminUserData || {};
  const img    = document.getElementById("profilePicPreviewImg");
  const inits  = document.getElementById("profilePicPreviewInitials");
  const saveBtn = document.getElementById("saveProfilePicBtn");

  if (data.profilePic) {
    img.src = data.profilePic;
    img.style.display = "block";
    inits.style.display = "none";
  } else {
    img.style.display = "none";
    inits.style.display = "";
    inits.textContent = _initials(data.name || "A");
  }

  saveBtn.disabled = true;
  document.getElementById("profilePicInput").value = "";
  _showOverlay("profilePicOverlay");
}

function closeProfilePicModal() {
  _hideOverlay("profilePicOverlay");
}

function previewProfilePic(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    _profilePicDataUrl = e.target.result;

    const img   = document.getElementById("profilePicPreviewImg");
    const inits = document.getElementById("profilePicPreviewInitials");
    img.src = _profilePicDataUrl;
    img.style.display = "block";
    inits.style.display = "none";

    document.getElementById("saveProfilePicBtn").disabled = false;
  };
  reader.readAsDataURL(file);
}

async function saveProfilePic() {
  if (!_profilePicDataUrl || !_adminUserData) return;
  const btn = document.getElementById("saveProfilePicBtn");
  showLoading(btn, "Saving...");

  try {
    // Resize to 200×200 max before storing
    const resized = await _resizeImage(_profilePicDataUrl, 200, 200);

    await db.collection("users").doc(_adminUserData.uid).update({
      profilePic: resized
    });

    _adminUserData.profilePic = resized;
    _setAdminAvatar(_adminUserData);

    showToast("Profile photo updated.", "success");
    closeProfilePicModal();
  } catch (err) {
    showToast("Failed to save photo.", "error");
  } finally {
    hideLoading(btn);
  }
}

async function removeProfilePic() {
  if (!_adminUserData) return;
  try {
    await db.collection("users").doc(_adminUserData.uid).update({ profilePic: null });
    _adminUserData.profilePic = null;
    _setAdminAvatar(_adminUserData);
    showToast("Profile photo removed.", "success");
    closeProfilePicModal();
  } catch (err) {
    showToast("Failed to remove photo.", "error");
  }
}

/** Resize an image dataUrl to maxW×maxH, returns a new dataUrl. */
function _resizeImage(dataUrl, maxW, maxH) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale  = Math.min(1, maxW / img.width, maxH / img.height);
      const w      = Math.round(img.width  * scale);
      const h      = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.src = dataUrl;
  });
}
