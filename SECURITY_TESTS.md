# ECOFUELS Attendance System — Security Testing Guide

## Round 2 — Automated + Manual Tests

---

## Setup — Firebase Emulator

```bash
# Install Firebase CLI (if not already installed)
npm install -g firebase-tools

# Install test dependencies
npm install

# Start the Firestore emulator only
firebase emulators:start --only firestore

# In a second terminal, run tests
npm test

# OR run emulator + tests in one command
npm run test:emulator
```

---

## Automated Test Coverage (security.test.js)

| Test Group | Tests |
|---|---|
| Employee privilege escalation | 9 tests |
| DM room access control | 6 tests |
| Chat message injection | 6 tests |
| Attendance integrity + offline | 10 tests |
| Request ownership + approval | 9 tests |
| Admin field restrictions | 5 tests |
| **Total** | **45 tests** |

---

## Manual Verification Checklist

### 1. Production Rules Verification
Before deploying, check the CURRENT rules in Firebase Console:
- https://console.firebase.google.com/project/economercadofuel/firestore/rules
- Compare with `firestore.rules` in this branch

### 2. DM Privacy (new in Round 2)
1. Log in as Employee A
2. Send a DM to Employee B
3. Log in as Employee C (not in that DM)
4. Run in console: `db.collection("chatRooms").doc("DM_ROOM_ID").get()`
5. **Expected**: PERMISSION_DENIED

### 3. Message Injection into DM (new in Round 2)
1. Log in as Employee C
2. Find the DM room ID between A and B
3. Run: `db.collection("chatRooms").doc("DM_ROOM_ID").collection("messages").add({ senderId: auth.currentUser.uid, text: "injected" })`
4. **Expected**: PERMISSION_DENIED

### 4. Admin Self-Role-Change (new in Round 2)
1. Log in as admin
2. Run: `db.collection("users").doc(auth.currentUser.uid).update({ role: "employee" })`
3. **Expected**: PERMISSION_DENIED

### 5. Request Pre-Approval (existing + validated)
1. Log in as employee
2. Run: `db.collection("requests").add({ employeeId: auth.currentUser.uid, status: "approved", ... })`
3. **Expected**: PERMISSION_DENIED

### 6. Attendance Field Injection
1. Log in as employee
2. Run: `db.collection("attendance").add({ employeeId: auth.currentUser.uid, type: "check_in", role: "admin", timestamp: ... })`
3. **Expected**: PERMISSION_DENIED (forbidden field `role`)

### 7. Offline Attendance Sync
1. Enable airplane mode
2. Check in — "Saving offline..." appears
3. Re-enable internet
4. **Expected**: Toast "Back online — syncing attendance records..." and record appears in admin

### 8. Security Headers
Visit: https://securityheaders.com/?q=https://economercadofuel.web.app
- Expected minimum score: **A**
- Verify: X-Frame-Options, CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy

---

## Known Remaining Risks

| Risk | Severity | Notes |
|---|---|---|
| Timestamp integrity for offline records | LOW | Server timestamp set at sync time, not capture time. Cannot be fixed without a Cloud Function backend. Accepted limitation. |
| Duplicate attendance (same day, same type) | LOW | Firestore rules cannot query existing records within a create operation. Deduplication is application-side only. |
| Storage rules not active | MEDIUM | Firebase Storage not enabled on project. `storage.rules` are ready but dormant. Enable Storage and deploy when needed. |
| Custom claims for Storage admin | LOW | Storage rules now use Firestore-based check instead of custom claims. No action needed unless Storage is enabled. |

---

## Deployment Instructions (requires explicit approval)

```bash
# NEVER run without approval

# 1. Deploy Firestore rules only (safest first step)
firebase deploy --only firestore:rules

# 2. Verify app still works, then deploy hosting
firebase deploy --only hosting

# 3. If Storage is enabled in Firebase Console:
firebase deploy --only storage
```

## Rollback Instructions

```bash
# Immediately roll back rules if anything breaks
git checkout main -- firestore.rules storage.rules
firebase deploy --only firestore:rules

# Full rollback to previous commit
git revert HEAD
firebase deploy --only firestore:rules,hosting
```
