/**
 * Authentication — login page.
 * Supports offline auto-login using cached Firebase Auth session.
 */

const CACHED_ROLE_KEY = "att_cached_role";
let _authHandled = false;

document.addEventListener("DOMContentLoaded", () => {
  if (!isFirebaseConfigured()) {
    document.getElementById("configWarning").classList.remove("hidden");
  }

  // If already signed in (cached session), redirect immediately.
  // Works offline because Firebase Auth persists the token locally.
  auth.onAuthStateChanged(async (user) => {
    if (user && !_authHandled) {
      _authHandled = true;

      if (!navigator.onLine) {
        // NOTE: localStorage role is used only for routing, NOT for authorization.
        // Both admin.html and employee.html re-verify role from Firestore on load.
        // An attacker who changes localStorage to "admin" will be redirected
        // to admin.html but immediately bounced back when Firestore confirms
        // they are not an admin.
        const cachedRole = localStorage.getItem(CACHED_ROLE_KEY);
        if (cachedRole === "admin" || cachedRole === "employee") {
          window.location.href = cachedRole === "admin" ? "admin.html" : "employee.html";
        } else {
          _authHandled = false;
          _showError("You are offline. Please connect to the internet for your first login.");
        }
        return;
      }

      await _redirectByRole(user);
    }
  });

  document.getElementById("loginForm").addEventListener("submit", handleLogin);
});

/* ------------------------------------------------------------------ */
/* Login                                                               */
/* ------------------------------------------------------------------ */

async function handleLogin(e) {
  e.preventDefault();

  const btn      = document.getElementById("loginBtn");
  const email    = document.getElementById("loginEmail").value.trim().toLowerCase();
  const password = document.getElementById("loginPassword").value;

  _showError("");

  // Offline handling — don't set _authHandled until we know we can proceed
  if (!navigator.onLine) {
    const cachedRole   = localStorage.getItem(CACHED_ROLE_KEY);
    const currentUser  = auth.currentUser;

    if (currentUser && cachedRole) {
      // Cached session exists — redirect directly
      _authHandled = true;
      window.location.href = cachedRole === "admin" ? "admin.html" : "employee.html";
      return;
    }

    _showError("No internet connection. Please connect to the internet to log in.");
    return;
  }

  // Online login
  _authHandled = true; // set here, after all early-returns above
  showLoading(btn, "Signing in...");

  try {
    const cred = await auth.signInWithEmailAndPassword(email, password);

    // Write session token (non-critical)
    const newToken = _generateToken();
    try {
      await db.collection("users").doc(cred.user.uid).set({
        sessionToken:    newToken,
        lastLoginAt:     firebase.firestore.FieldValue.serverTimestamp(),
        lastLoginDevice: getDeviceId()
      }, { merge: true });
      localStorage.setItem(SESSION_TOKEN_KEY, newToken);
    } catch (tokenErr) {
      console.warn("Session token write failed:", tokenErr);
    }

    await _redirectByRole(cred.user);

  } catch (err) {
    hideLoading(btn);
    _authHandled = false; // allow retry

    const code = err.code || "";
    const msg =
      code === "auth/invalid-credential" ||
      code === "auth/user-not-found"     ||
      code === "auth/wrong-password"     ||
      code === "auth/invalid-email"
        ? "Invalid username or password."
        : code === "auth/too-many-requests"
        ? "Too many failed attempts. Please try again later."
        : code === "auth/network-request-failed"
        ? "No internet connection. Please check your network."
        : err.message || "Login failed. Please try again.";

    _showError(msg);
    showToast(msg, "error");
  }
}

/* ------------------------------------------------------------------ */
/* Role-based redirect                                                 */
/* ------------------------------------------------------------------ */

async function _redirectByRole(user) {
  const btn = document.getElementById("loginBtn");
  try {
    const userDoc = await db.collection("users").doc(user.uid).get();

    if (!userDoc.exists) {
      const cachedRole = localStorage.getItem(CACHED_ROLE_KEY);
      if (!navigator.onLine && cachedRole) {
        window.location.href = cachedRole === "admin" ? "admin.html" : "employee.html";
        return;
      }
      await auth.signOut();
      localStorage.removeItem(SESSION_TOKEN_KEY);
      localStorage.removeItem(CACHED_ROLE_KEY);
      _authHandled = false;
      hideLoading(btn);
      _showError("Account not found. Contact your administrator.");
      return;
    }

    const data = userDoc.data();

    if (data.active === false || data.active === "false") {
      await auth.signOut();
      localStorage.removeItem(SESSION_TOKEN_KEY);
      localStorage.removeItem(CACHED_ROLE_KEY);
      _authHandled = false;
      hideLoading(btn);
      _showError("This account has been deactivated.");
      return;
    }

    // Keep Firestore email in sync with Auth email (fixes mismatches from manual edits)
    if (data.email !== user.email && user.email) {
      db.collection("users").doc(user.uid).update({ email: user.email }).catch(() => {});
    }

    // Cache role for offline use
    localStorage.setItem(CACHED_ROLE_KEY, data.role);

    window.location.href = data.role === "admin" ? "admin.html" : "employee.html";

  } catch (err) {
    const cachedRole = localStorage.getItem(CACHED_ROLE_KEY);
    if (!navigator.onLine && cachedRole) {
      window.location.href = cachedRole === "admin" ? "admin.html" : "employee.html";
      return;
    }
    console.error("Redirect error:", err);
    hideLoading(btn);
    _authHandled = false;
    _showError("Error loading your account. Please try again.");
  }
}

/* ------------------------------------------------------------------ */
/* Inline error display                                                */
/* ------------------------------------------------------------------ */

function _showError(msg) {
  let el = document.getElementById("loginError");
  if (!el) {
    el = document.createElement("div");
    el.id = "loginError";
    el.style.cssText = `
      background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;
      border-radius:8px;padding:10px 14px;font-size:.875rem;
      margin-bottom:16px;display:none;
    `;
    const form = document.getElementById("loginForm");
    form.insertBefore(el, form.firstChild);
  }
  el.textContent = msg;
  el.style.display = msg ? "block" : "none";
}

function _generateToken() {
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}
