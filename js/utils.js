/**
 * Shared utility helpers used across all pages.
 */

/* ------------------------------------------------------------------ */
/* Toast notifications                                                 */
/* ------------------------------------------------------------------ */

function showToast(message, type = "info", duration = 4000) {
  const container =
    document.getElementById("toastContainer") || _ensureToastContainer();

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span class="toast__msg">${message}</span>`;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("toast--show"));

  setTimeout(() => {
    toast.classList.remove("toast--show");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function _ensureToastContainer() {
  let c = document.getElementById("toastContainer");
  if (!c) {
    c = document.createElement("div");
    c.id = "toastContainer";
    c.className = "toast-container";
    document.body.appendChild(c);
  }
  return c;
}

/* ------------------------------------------------------------------ */
/* Manual card and panel resizing                                     */
/* ------------------------------------------------------------------ */

/** Clear all saved panel sizes for the current page — call to reset layout */
function resetAllPanelSizes() {
  const page   = location.pathname.split("/").pop() || "index.html";
  const prefix = `ecofuels-panel-size:${page}:`;
  Object.keys(localStorage)
    .filter((k) => k.startsWith(prefix))
    .forEach((k) => localStorage.removeItem(k));
  document.querySelectorAll(".manual-resizable").forEach((el) => {
    el.style.removeProperty("width");
    el.style.removeProperty("height");
    el.style.removeProperty("flex");
  });
  showToast("Layout reset to default.", "success");
}

// On employee page — immediately wipe any stale saved sizes
if (location.pathname.includes("employee")) {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("ecofuels-panel-size:employee"))
      .forEach((k) => localStorage.removeItem(k));
  } catch (_) {}
}
function initManualResizing() {
  // Disabled on employee page — cards flow naturally
  if (location.pathname.includes("employee")) return;

  const selectors = [
    ".card",
    ".emp-panel",
    ".status-card",
    ".chat-layout",
    ".modal",
    ".dashboard-bottom",
    ".attendance-workspace"
  ].join(",");

  // Cards that should NEVER be user-resized
  const excludeSelectors = [
    ".emp-camera-card",
    ".status-card",
    ".chat-layout",
    ".modal",
    "#panel-chat"
  ];

  const page = location.pathname.split("/").pop() || "index.html";
  const storagePrefix = `ecofuels-panel-size:${page}:`;

  document.querySelectorAll(selectors).forEach((panel, index) => {
    if (panel.classList.contains("manual-resizable")) return;

    // Skip excluded elements
    if (excludeSelectors.some((sel) => panel.matches(sel))) return;

    panel.classList.add("manual-resizable");
    const key = `${storagePrefix}${index}:${panel.className}`;

    const saved = (() => {
      try { return JSON.parse(localStorage.getItem(key)); }
      catch (_) { return null; }
    })();
    if (saved?.width && saved?.height) {
      panel.style.width = `${saved.width}px`;
      panel.style.height = `${saved.height}px`;
      panel.style.flex = "none";
    }

    const handle = document.createElement("div");
    handle.className = "panel-resize-handle";
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-label", "Drag to resize panel");
    handle.title = "Drag to resize. Double-click to reset.";
    panel.appendChild(handle);

    const resetSize = () => {
      panel.style.removeProperty("width");
      panel.style.removeProperty("height");
      panel.style.removeProperty("flex");
      localStorage.removeItem(key);
    };
    handle.addEventListener("dblclick", resetSize);

    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      handle.setPointerCapture?.(event.pointerId);

      const rect = panel.getBoundingClientRect();
      if (!rect) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = rect.width;
      const startHeight = rect.height;

      panel.style.width = `${startWidth}px`;
      panel.style.height = `${startHeight}px`;
      panel.style.flex = "none";

      const move = (moveEvent) => {
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        const width = Math.max(240, Math.min(viewportWidth - 16, startWidth + moveEvent.clientX - startX));
        const height = Math.max(120, Math.min(viewportHeight - 16, startHeight + moveEvent.clientY - startY));
        panel.style.width = `${Math.round(width)}px`;
        panel.style.height = `${Math.round(height)}px`;
      };

      const stop = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
        try {
          localStorage.setItem(key, JSON.stringify({
            width: Math.round(panel.getBoundingClientRect().width),
            height: Math.round(panel.getBoundingClientRect().height)
          }));
        } catch (_) {}
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => requestAnimationFrame(initManualResizing));
} else {
  requestAnimationFrame(initManualResizing);
}

let manualResizeTimer = null;
const manualResizeObserver = new MutationObserver(() => {
  clearTimeout(manualResizeTimer);
  manualResizeTimer = setTimeout(initManualResizing, 250);
});
manualResizeObserver.observe(document.documentElement, {
  childList: true,
  subtree: true
});

/* ------------------------------------------------------------------ */
/* Date / time formatting                                              */
/* ------------------------------------------------------------------ */

function formatDate(date) {
  if (!date) return "—";
  const d = date instanceof Date ? date : date.toDate();
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function formatTime(date) {
  if (!date) return "—";
  const d = date instanceof Date ? date : date.toDate();
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatDateTime(date) {
  if (!date) return "—";
  return `${formatDate(date)} ${formatTime(date)}`;
}

/** Returns YYYY-MM-DD for <input type="date"> fields. */
function toDateInput(date) {
  const d = date instanceof Date ? date : date.toDate();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Returns HH:MM for <input type="time"> fields. */
function toTimeInput(date) {
  const d = date instanceof Date ? date : date.toDate();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** Start of today (00:00) as a JS Date. */
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** End of today (23:59:59) as a JS Date. */
function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

/* ------------------------------------------------------------------ */
/* Geolocation math (Haversine)                                        */
/* ------------------------------------------------------------------ */

/** Distance in meters between two lat/lng points. */
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius (m)
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/** Human-readable distance (e.g. "320 m" or "1.5 km"). */
function formatDistance(meters) {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/* ------------------------------------------------------------------ */
/* Device fingerprinting (one device per employee)                    */
/* ------------------------------------------------------------------ */

const DEVICE_ID_KEY = "attendance_device_id";

/** Returns a stable device id stored in localStorage. */
function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = _generateDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function _generateDeviceId() {
  // Combine browser fingerprint with a random UUID
  const fingerprint = [
    navigator.userAgent,
    navigator.language,
    screen.width + "x" + screen.height,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || "unknown"
  ].join("|");

  const random = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${_hashString(fingerprint)}-${random}`;
}

function _hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

/* ------------------------------------------------------------------ */
/* Loading helpers                                                     */
/* ------------------------------------------------------------------ */

function showLoading(el, text = "Loading...") {
  if (typeof el === "string") el = document.getElementById(el);
  if (!el) return;
  el.dataset._original = el.innerHTML;
  el.innerHTML = `<span class="spinner"></span> ${text}`;
  el.disabled = true;
}

function hideLoading(el) {
  if (typeof el === "string") el = document.getElementById(el);
  if (!el) return;
  if (el.dataset._original !== undefined) {
    el.innerHTML = el.dataset._original;
    delete el.dataset._original;
  }
  el.disabled = false;
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

/** Escape HTML to prevent XSS in dynamically built strings. */
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Convert a Float32Array (face descriptor) to a plain array for Firestore. */
function descriptorToArray(descriptor) {
  return Array.from(descriptor);
}

/** Convert a plain array back to Float32Array for face-api comparison. */
function arrayToDescriptor(arr) {
  return new Float32Array(arr);
}

/** Format "X minutes ago" style relative time. */
function timeAgo(date) {
  const d = date instanceof Date ? date : date.toDate();
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

/* ------------------------------------------------------------------ */
/* Auth helper (shared across pages)                                   */
/* ------------------------------------------------------------------ */

/** Sign out the current user and return to the login page. */
async function logout() {
  try {
    await auth.signOut();
    window.location.href = "index.html";
  } catch (err) {
    showToast("Error signing out.", "error");
  }
}

/* ------------------------------------------------------------------ */
/* Email domain helper                                                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Session enforcement (single active device)                         */
/* ------------------------------------------------------------------ */

const SESSION_TOKEN_KEY = "att_session_token";

/**
 * Starts a real-time listener on the user's Firestore document.
 * If the sessionToken stored in Firestore no longer matches the one
 * saved in localStorage (meaning another device logged in), this
 * device is signed out immediately.
 *
 * @param {string} uid  - Firebase Auth UID of the current user
 * @returns {function}  - Unsubscribe function to stop the listener
 */
function watchSession(uid) {
  const localToken = localStorage.getItem(SESSION_TOKEN_KEY);

  const unsubscribe = db.collection("users").doc(uid).onSnapshot((doc) => {
    if (!doc.exists) return;

    const remoteToken = doc.data().sessionToken;

    // If Firestore has a token but it doesn't match ours, we've been displaced
    if (remoteToken && localToken && remoteToken !== localToken) {
      unsubscribe();
      auth.signOut().then(() => {
        localStorage.removeItem(SESSION_TOKEN_KEY);
        // Show a message then redirect
        alert("You have been signed out because this account was logged in on another device.");
        window.location.href = "index.html";
      });
    }
  }, (err) => {
    console.warn("Session watch error:", err);
  });

  return unsubscribe;
}

/* ------------------------------------------------------------------ */
/* Online / offline detection                                          */
/* ------------------------------------------------------------------ */

function _updateOnlineStatus() {
  const banner = document.getElementById("offlineBanner");
  if (!banner) return;
  if (navigator.onLine) {
    banner.classList.add("hidden");
  } else {
    banner.classList.remove("hidden");
  }
}

window.addEventListener("online",  _updateOnlineStatus);
window.addEventListener("offline", _updateOnlineStatus);

// Run once on load
document.addEventListener("DOMContentLoaded", _updateOnlineStatus);
