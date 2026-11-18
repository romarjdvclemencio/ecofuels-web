# ECOFUELS Attendance System — Security Testing Checklist

## Setup
Use Firebase Emulator Suite for safe testing:
```bash
firebase emulators:start --only firestore,storage,auth
```

---

## 1. Employee Account Security

### 1a. Employee cannot promote themselves to admin
**Test:**
1. Log in as a regular employee
2. Open browser DevTools → Console
3. Run: `db.collection("users").doc(firebase.auth().currentUser.uid).update({ role: "admin" })`
4. **Expected:** Firestore rejects with PERMISSION_DENIED

### 1b. Employee cannot change their own role, active status, or department
**Test:**
1. Log in as employee
2. Run in console:
   ```js
   db.collection("users").doc(firebase.auth().currentUser.uid)
     .update({ role: "admin", active: true, isDepartmentHead: true })
   ```
3. **Expected:** PERMISSION_DENIED

### 1c. Employee cannot access admin.html
**Test:**
1. Log in as employee → open `admin.html` directly in URL bar
2. **Expected:** Immediately redirected to `index.html` (Firestore role check fails)

### 1d. Admin page survives localStorage manipulation
**Test:**
1. Log in as employee
2. Open DevTools → Application → Local Storage → change `att_cached_role` to `admin`
3. Navigate to `admin.html`
4. **Expected:** Redirected to `index.html` — Firestore confirms role is `employee`

---

## 2. Attendance Security

### 2a. Employee can submit their own attendance
**Test:**
1. Log in as employee → start camera → Check In
2. **Expected:** Record created with `employeeId == auth.currentUser.uid`

### 2b. Employee cannot submit attendance under another UID
**Test:**
1. Log in as employee
2. Run in console:
   ```js
   db.collection("attendance").add({
     employeeId: "ANOTHER_EMPLOYEE_UID",
     type: "check_in",
     timestamp: firebase.firestore.FieldValue.serverTimestamp()
   })
   ```
3. **Expected:** PERMISSION_DENIED (Firestore rule: `employeeId == request.auth.uid`)

### 2c. Employee cannot edit or delete attendance records
**Test:**
1. Find an attendance doc ID in Firestore
2. Run: `db.collection("attendance").doc("RECORD_ID").update({ type: "check_out" })`
3. **Expected:** PERMISSION_DENIED

### 2d. Offline attendance still synchronizes correctly
**Test:**
1. Enable airplane mode on device
2. Check in → "Saving offline..." appears
3. Re-enable internet
4. **Expected:** Toast "Back online — syncing attendance records..." then record appears in admin dashboard

---

## 3. Chat Security

### 3a. DM messages readable only by participants
**Test:**
1. Log in as Employee A, send a DM to Employee B
2. Log in as Employee C (not in that DM)
3. Run: `db.collection("chatRooms").doc("DM_ROOM_ID").collection("messages").get()`
4. **Expected:** PERMISSION_DENIED

### 3b. Employee cannot add themselves to unauthorized DM rooms
**Test:**
1. Log in as employee
2. Try to create a DM room without including own UID:
   ```js
   db.collection("chatRooms").add({
     type: "dm",
     members: ["OTHER_UID_1", "OTHER_UID_2"]
   })
   ```
3. **Expected:** PERMISSION_DENIED (members must include `request.auth.uid`)

### 3c. Chat message senderId cannot be forged
**Test:**
1. Log in as Employee A
2. Run:
   ```js
   db.collection("chatRooms").doc("GENERAL_ROOM_ID")
     .collection("messages").add({
       senderId: "EMPLOYEE_B_UID",
       senderName: "Fake",
       text: "Impersonation test",
       createdAt: firebase.firestore.FieldValue.serverTimestamp()
     })
   ```
3. **Expected:** PERMISSION_DENIED (`senderId` must equal `request.auth.uid`)

---

## 4. Requests Security

### 4a. Employee can submit their own requests
**Test:**
1. Log in as employee → Requests tab → New Request → submit
2. **Expected:** Request created with `employeeId == auth.currentUser.uid`, `status == "pending"`

### 4b. Employee cannot view another employee's requests
**Test:**
1. Log in as Employee A
2. Run: `db.collection("requests").where("employeeId","==","EMPLOYEE_B_UID").get()`
3. **Expected:** Empty result or PERMISSION_DENIED (rule reads own requests only)

### 4c. Employee cannot approve their own request
**Test:**
1. Find own request doc ID
2. Run: `db.collection("requests").doc("MY_REQUEST_ID").update({ status: "approved" })`
3. **Expected:** PERMISSION_DENIED (only admin can update requests)

### 4d. Employee cannot create a request with pre-approved status
**Test:**
1. Run:
   ```js
   db.collection("requests").add({
     employeeId: firebase.auth().currentUser.uid,
     status: "approved",
     requestTypeName: "Test"
   })
   ```
2. **Expected:** PERMISSION_DENIED (`status` must be `"pending"` on create)

---

## 5. Storage Security

### 5a. Employee cannot upload prohibited file types
**Test:**
1. Try uploading a `.html` or `.exe` file as a photo
2. **Expected:** Storage rule rejects (not `image/jpeg` or `image/png`)

### 5b. File size limit enforced
**Test:**
1. Try uploading a file > 500KB
2. **Expected:** Storage rule rejects

### 5c. Employee cannot delete another employee's photo
**Test:**
1. Log in as Employee A
2. Run: `firebase.storage().ref("employee_photos/EMPLOYEE_B_UID.jpg").delete()`
3. **Expected:** PERMISSION_DENIED (delete requires admin)

---

## 6. Security Headers Verification

After deploying `firebase.json`, verify headers at:
https://securityheaders.com/?q=https://economercadofuel.web.app

**Expected minimum score:** A

Check for:
- `X-Frame-Options: DENY` ✓
- `X-Content-Type-Options: nosniff` ✓
- `Strict-Transport-Security` ✓
- `Content-Security-Policy` ✓
- `Referrer-Policy` ✓
- `Permissions-Policy` ✓

---

## 7. Firebase Emulator Automated Rule Tests

Install test runner:
```bash
npm install --save-dev @firebase/rules-unit-testing jest
```

Run tests:
```bash
npx jest security.test.js
```

See `security.test.js` for automated Firestore rule assertions.
