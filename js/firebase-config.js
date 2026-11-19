/**
 * Firebase Configuration
 * ------------------------------------------------------------------
 * Replace the placeholder values below with your own Firebase project
 * credentials. You can find them in:
 *   Firebase Console -> Project Settings -> General -> Your apps -> Web app
 *
 * Make sure you enable:
 *   - Authentication -> Sign-in method -> Email/Password
 *   - Firestore Database
 *   - Storage
 * ------------------------------------------------------------------
 */

const firebaseConfig = {
  apiKey: "AIzaSyA4TGVCiwDo0R2LP-M1kL4aIWUMaNtKaSk",
  authDomain: "economercadofuel.firebaseapp.com",
  projectId: "economercadofuel",
  storageBucket: "economercadofuel.firebasestorage.app",
  messagingSenderId: "671546089673",
  appId: "1:671546089673:web:b52ce1e1ed70ce3671ed18",
  measurementId: "G-H6224YYBVJ"
};

// Initialize primary Firebase app
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();

// Initialize Firestore with offline persistence
const db = firebase.firestore();
// Suppress deprecation warning by not calling enablePersistence directly —
// instead configure persistence settings before any other Firestore calls.
try {
  db.settings({ merge: true });
  db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
      console.warn('Firestore persistence error:', err.code);
    }
  });
} catch (_) {}

// Storage is optional — we store photos as base64 in Firestore.
// Keep the reference for potential future use, but don't crash if
// Firebase Storage isn't enabled in the project.
let storage = null;
try {
  storage = firebase.storage();
} catch (e) {
  console.info("Firebase Storage not enabled — using Firestore for image storage.");
}

// Secondary app instance — used so the admin can create employee
// accounts without being signed out of their own session.
let _secondaryApp = null;
let _secondaryAuth = null;

function getSecondaryAuth() {
  if (!_secondaryApp) {
    _secondaryApp = firebase.initializeApp(firebaseConfig, "Secondary");
    _secondaryAuth = _secondaryApp.auth();
  }
  return _secondaryAuth;
}

/** Tear down the secondary instance after creating a user. */
async function cleanupSecondaryAuth() {
  if (_secondaryAuth) {
    try {
      await _secondaryAuth.signOut();
    } catch (_) { /* ignore */ }
  }
}

/** Returns true once the user has replaced the placeholder config. */
function isFirebaseConfigured() {
  return firebaseConfig.apiKey !== "YOUR_API_KEY";
}
