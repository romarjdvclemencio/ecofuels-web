/**
 * ECOFUELS Attendance System — Automated Firestore Security Rule Tests
 *
 * Run with Firebase Emulator:
 *   firebase emulators:start --only firestore
 *   npx jest security.test.js
 *
 * Install deps:
 *   npm install --save-dev @firebase/rules-unit-testing jest
 */

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} = require("@firebase/rules-unit-testing");
const { readFileSync } = require("fs");
const { setDoc, doc, getDoc, updateDoc, addDoc, collection, serverTimestamp } = require("firebase/firestore");

const PROJECT_ID = "economercadofuel-test";
const RULES      = readFileSync("firestore.rules", "utf8");

let testEnv;

// ---- Test UIDs ----
const ADMIN_UID     = "admin-uid-001";
const EMPLOYEE_A_UID = "employee-uid-001";
const EMPLOYEE_B_UID = "employee-uid-002";

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES }
  });

  // Seed admin user
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", ADMIN_UID), {
      uid: ADMIN_UID, email: "admin@test.com", name: "Admin",
      role: "admin", active: true, isDepartmentHead: false, departmentId: null
    });
    await setDoc(doc(db, "users", EMPLOYEE_A_UID), {
      uid: EMPLOYEE_A_UID, email: "empa@test.com", name: "Employee A",
      role: "employee", active: true, isDepartmentHead: false, departmentId: "dept-1"
    });
    await setDoc(doc(db, "users", EMPLOYEE_B_UID), {
      uid: EMPLOYEE_B_UID, email: "empb@test.com", name: "Employee B",
      role: "employee", active: true, isDepartmentHead: false, departmentId: "dept-2"
    });
    await setDoc(doc(db, "settings", "general"), {
      workStartTime: "08:00", workEndTime: "17:00"
    });
    await addDoc(collection(db, "attendance"), {
      employeeId: EMPLOYEE_A_UID, type: "check_in",
      timestamp: new Date(), employeeName: "Employee A"
    });
    await addDoc(collection(db, "requests"), {
      employeeId: EMPLOYEE_A_UID, status: "pending",
      requestTypeName: "Leave", createdAt: new Date()
    });
  });
});

afterAll(async () => testEnv.cleanup());

// ================================================================
// USERS
// ================================================================

describe("Users collection", () => {
  test("Employee cannot promote themselves to admin", async () => {
    const db = testEnv.authenticatedContext(EMPLOYEE_A_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "users", EMPLOYEE_A_UID), { role: "admin" })
    );
  });

  test("Employee cannot change their active status", async () => {
    const db = testEnv.authenticatedContext(EMPLOYEE_A_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "users", EMPLOYEE_A_UID), { active: false })
    );
  });

  test("Employee cannot change their department", async () => {
    const db = testEnv.authenticatedContext(EMPLOYEE_A_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "users", EMPLOYEE_A_UID), { departmentId: "dept-999" })
    );
  });

  test("Employee cannot read another employee's profile", async () => {
    const db = testEnv.authenticatedContext(EMPLOYEE_A_UID).firestore();
    await assertFails(getDoc(doc(db, "users", EMPLOYEE_B_UID)));
  });

  test("Employee can update own sessionToken", async () => {
    const db = testEnv.authenticatedContext(EMPLOYEE_A_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "users", EMPLOYEE_A_UID), { sessionToken: "new-token-123" })
    );
  });

  test("Admin can read any employee", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(getDoc(doc(db, "users", EMPLOYEE_A_UID)));
  });

  test("Admin can update employee role", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "users", EMPLOYEE_B_UID), { departmentId: "dept-1" })
    );
  });
});

// ================================================================
// ATTENDANCE
// ================================================================

describe("Attendance collection", () => {
  test("Employee can create attendance for own UID", async () => {
    const db = testEnv.authenticatedContext(EMPLOYEE_A_UID).firestore();
    await assertSucceeds(
      addDoc(collection(db, "attendance"), {
        employeeId: EMPLOYEE_A_UID,
        employeeName: "Employee A",
        type: "check_in",
        timestamp: new Date()
      })
    );
  });

  test("Employee cannot create attendance for another UID", async () => {
    const db = testEnv.authenticatedContext(EMPLOYEE_A_UID).firestore();
    await assertFails(
      addDoc(collection(db, "attendance"), {
        employeeId: EMPLOYEE_B_UID,
        type: "check_in",
        timestamp: new Date()
      })
    );
  });

  test("Invalid attendance type is rejected", async () => {
    const db = testEnv.authenticatedContext(EMPLOYEE_A_UID).firestore();
    await assertFails(
      addDoc(collection(db, "attendance"), {
        employeeId: EMPLOYEE_A_UID,
        type: "hack_attempt",
        timestamp: new Date()
      })
    );
  });
});

// ================================================================
// SETTINGS
// ================================================================

describe("Settings collection", () => {
  test("Employee cannot modify settings", async () => {
    const db = testEnv.authenticatedContext(EMPLOYEE_A_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "settings", "general"), { workStartTime: "06:00" })
    );
  });

  test("Admin can modify settings", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "settings", "general"), { gracePeriodMinutes: 10 })
    );
  });
});

// ================================================================
// CHAT MESSAGES
// ================================================================

describe("Chat messages", () => {
  let generalRoomId;

  beforeAll(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const ref = await addDoc(collection(ctx.firestore(), "chatRooms"), {
        name: "General", type: "general", departmentId: null
      });
      generalRoomId = ref.id;
    });
  });

  test("Employee cannot forge senderId in a message", async () => {
    const db = testEnv.authenticatedContext(EMPLOYEE_A_UID).firestore();
    await assertFails(
      addDoc(collection(db, "chatRooms", generalRoomId, "messages"), {
        senderId: EMPLOYEE_B_UID,
        senderName: "Impersonation",
        text: "Forged message",
        createdAt: new Date()
      })
    );
  });

  test("Employee can send a message with own UID", async () => {
    const db = testEnv.authenticatedContext(EMPLOYEE_A_UID).firestore();
    await assertSucceeds(
      addDoc(collection(db, "chatRooms", generalRoomId, "messages"), {
        senderId: EMPLOYEE_A_UID,
        senderName: "Employee A",
        text: "Hello!",
        createdAt: new Date()
      })
    );
  });

  test("Nobody can delete messages", async () => {
    let msgId;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const ref = await addDoc(
        collection(ctx.firestore(), "chatRooms", generalRoomId, "messages"),
        { senderId: EMPLOYEE_A_UID, senderName: "A", text: "del test", createdAt: new Date() }
      );
      msgId = ref.id;
    });
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    const { deleteDoc } = require("firebase/firestore");
    await assertFails(
      deleteDoc(doc(db, "chatRooms", generalRoomId, "messages", msgId))
    );
  });
});

// ================================================================
// REQUESTS
// ================================================================

describe("Requests collection", () => {
  test("Employee cannot create a pre-approved request", async () => {
    const db = testEnv.authenticatedContext(EMPLOYEE_A_UID).firestore();
    await assertFails(
      addDoc(collection(db, "requests"), {
        employeeId: EMPLOYEE_A_UID,
        status: "approved",
        requestTypeName: "Leave",
        createdAt: new Date()
      })
    );
  });

  test("Employee cannot create a request under another UID", async () => {
    const db = testEnv.authenticatedContext(EMPLOYEE_A_UID).firestore();
    await assertFails(
      addDoc(collection(db, "requests"), {
        employeeId: EMPLOYEE_B_UID,
        status: "pending",
        requestTypeName: "Leave",
        createdAt: new Date()
      })
    );
  });
});
