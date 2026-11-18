/**
 * PWA Install Banner
 * Shows an install prompt on all pages when the app is installable.
 * Works on Android Chrome automatically.
 * On iPhone Safari it shows manual instructions instead.
 */

const INSTALL_DISMISSED_KEY = "pwa_install_dismissed";

let _deferredPrompt = null;

/* ------------------------------------------------------------------ */
/* Capture the browser's install prompt (Android / Chrome)            */
/* ------------------------------------------------------------------ */
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  _deferredPrompt = e;

  // Don't show if user already dismissed it this session
  if (sessionStorage.getItem(INSTALL_DISMISSED_KEY)) return;

  // Don't show if already installed
  if (window.matchMedia("(display-mode: standalone)").matches) return;

  showInstallBanner();
});

/* ------------------------------------------------------------------ */
/* Show the banner                                                     */
/* ------------------------------------------------------------------ */
function showInstallBanner() {
  const banner = document.getElementById("installBanner");
  if (!banner) return;
  banner.classList.add("show");
}

function hideInstallBanner() {
  const banner = document.getElementById("installBanner");
  if (!banner) return;
  banner.classList.remove("show");
}

/* ------------------------------------------------------------------ */
/* Wire up buttons once DOM is ready                                   */
/* ------------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  const installBtn  = document.getElementById("installBtn");
  const dismissBtn  = document.getElementById("installDismiss");

  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      if (_deferredPrompt) {
        // Android / Chrome: trigger native install dialog
        _deferredPrompt.prompt();
        const { outcome } = await _deferredPrompt.userChoice;
        _deferredPrompt = null;
        hideInstallBanner();
      } else {
        // iPhone / Safari: show manual instructions
        _showIosInstructions();
      }
    });
  }

  if (dismissBtn) {
    dismissBtn.addEventListener("click", () => {
      hideInstallBanner();
      sessionStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    });
  }

  // Check if running on iOS Safari (no beforeinstallprompt support)
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandaloneMode = window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone;

  if (isIos && !isInStandaloneMode && !sessionStorage.getItem(INSTALL_DISMISSED_KEY)) {
    // Show banner with iOS-specific button text
    const banner = document.getElementById("installBanner");
    if (banner) {
      const text = banner.querySelector(".install-banner__text");
      if (text) {
        text.innerHTML = `
          <strong>Install Eco Fuels Attendance</strong>
          Tap the button to learn how to add to your home screen
        `;
      }
      banner.classList.add("show");
    }
  }

  // Hide banner if already installed (standalone mode)
  if (isInStandaloneMode) {
    hideInstallBanner();
  }
});

/* ------------------------------------------------------------------ */
/* iOS manual instructions modal                                       */
/* ------------------------------------------------------------------ */
function _showIosInstructions() {
  // Remove any existing modal
  const existing = document.getElementById("iosInstallModal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "iosInstallModal";
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.6);
    z-index:10000;display:flex;align-items:flex-end;
    justify-content:center;padding:16px;
  `;

  modal.innerHTML = `
    <div style="
      background:#fff;border-radius:16px;padding:24px;
      max-width:420px;width:100%;text-align:center;
    ">
      <div style="font-size:1.1rem;font-weight:700;margin-bottom:12px;color:#14532d;">
        Add to Home Screen
      </div>
      <div style="font-size:.9rem;color:#374151;line-height:1.6;">
        <p style="margin-bottom:10px;">To install this app on your iPhone or iPad:</p>
        <ol style="text-align:left;padding-left:20px;margin-bottom:16px;">
          <li style="margin-bottom:6px;">Tap the <strong>Share</strong> button at the bottom of Safari (the box with an arrow pointing up)</li>
          <li style="margin-bottom:6px;">Scroll down and tap <strong>"Add to Home Screen"</strong></li>
          <li>Tap <strong>"Add"</strong> in the top right corner</li>
        </ol>
        <p style="font-size:.8rem;color:#6b7280;">The app will appear on your home screen like a regular app.</p>
      </div>
      <button onclick="document.getElementById('iosInstallModal').remove()" style="
        margin-top:16px;background:#16a34a;color:#fff;border:none;
        border-radius:8px;padding:10px 32px;font-size:.95rem;
        font-weight:600;cursor:pointer;width:100%;
      ">Got it</button>
    </div>
  `;

  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });
}

/* ------------------------------------------------------------------ */
/* Hide banner after successful install                                */
/* ------------------------------------------------------------------ */
window.addEventListener("appinstalled", () => {
  hideInstallBanner();
  _deferredPrompt = null;
});
