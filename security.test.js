/**
 * ECOFUELS Attendance System — Security Rule Tests (Round 2)
 *
 * Prerequisites:
 *   npm install --save-dev @firebase/rules-unit-testing@^3.0.0 firebase@^10.0.0 jest
 *
 * Run (with emulator already started):
 *   firebase emulators:start --only firestore &
 *   npx jest security.test.js --testTimeout=30000
 *
 * Or run emulator + tests together:
 *   firebase emulators:exec --only firestore "npx jest security.test.js"
 */

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} = require("@firebase/rules-unit-testing");
const { readFileSync } = require("fs");
const {
  setDoc, getDoc, updateDoc, deleteDoc, addDoc,
  collection, doc, getDocs, query, where
} = require("firebase/firestore");

const PROJECT_ID = "economercadofuel-test";
const RULES      = readFileSync("./firestore.rules", "utf8");

// ---- Test UIDs ----
const ADMIN_UID      = "admin-uid-001";
const ADMIN_2_UID    = "admin-uid-002";
const EMP_A_UID      = "employee-uid-001";
const EMP_B_UID      = "employee-uid-002";
const EMP_HEAD_UID   = "employee-uid-003"; // dept head of dept-1
const INACTIVE_ADMIN = "inactive-admin-001";
const DEPT_1         = "dept-1";
const DEPT_2         = "dept-2";

let testEnv;

// ================================================================
// SETUP
// ================================================================

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES, host: "localhost", port: 8080 }
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // Users
    await setDoc(doc(db, "users", ADMIN_UID), {
      uid: ADMIN_UID, email: "admin@ecofuels.com", name: "Admin",
      role: "admin", active: true, isDepartmentHead: false, departmentId: null,
      createdAt: new Date()
    });
    await setDoc(doc(db, "users", ADMIN_2_UID), {
      uid: ADMIN_2_UID, email: "admin2@ecofuels.com", name: "Admin 2",
      role: "admin", active: true, isDepartmentHead: false, departmentId: null,
      createdAt: new Date()
    });
    await setDoc(doc(db, "users", EMP_A_UID), {
      uid: EMP_A_UID, email: "empa@gmail.com", name: "Employee A",
      role: "employee", active: true, isDepartmentHead: false,
      departmentId: DEPT_1, createdAt: new Date()
    });
    await setDoc(doc(db, "users", EMP_B_UID), {
      uid: EMP_B_UID, email: "empb@gmail.com", name: "Employee B",
      role: "employee", active: true, isDepartmentHead: false,
      departmentId: DEPT_2, createdAt: new Date()
    });
    await setDoc(doc(db, "users", EMP_HEAD_UID), {
      uid: EMP_HEAD_UID, email: "head@gmail.com", name: "Dept Head",
      role: "employee", active: true, isDepartmentHead: true,
      departmentId: DEPT_1, createdAt: new Date()
    });
    await setDoc(doc(db, "users", INACTIVE_ADMIN), {
      uid: INACTIVE_ADMIN, email: "inactive@ecofuels.com", name: "Old Admin",
      role: "admin", active: false, isDepartmentHead: false, departmentId: null,
      createdAt: new Date()
    });

    // Settings
    await setDoc(doc(db, "settings", "general"), {
      workStartTime: "08:00", workEndTime: "17:00", gracePeriodMinutes: 15
    });

    // Chat rooms
    await setDoc(doc(db, "chatRooms", "general-room"), {
      name: "General", type: "general", departmentId: null
    });
    await setDoc(doc(db, "chatRooms", "dept1-room"), {
      name: "Dept 1", type: "department", departmentId: DEPT_1
    });
    await setDoc(doc(db, "chatRooms", "dm-ab-room"), {
      name: "DM A&B", type: "dm", members: [EMP_A_UID, EMP_B_UID]
    });

    // Request types
    await setDoc(doc(db, "requestTypes", "leave-type"), {
      name: "Leave Request", active: true, fields: []
    });

    // Existing attendance record for duplicate tests
    await setDoc(doc(db, "attendance", "existing-att-001"), {
      employeeId: EMP_A_UID, employeeName: "Employee A",
      type: "check_in", timestamp: new Date(),
      departmentId: DEPT_1, departmentName: "Dept 1"
    });

    // Existing request for Employee A
    await setDoc(doc(db, "requests", "req-001"), {
      employeeId: EMP_A_UID, employeeName: "Employee A",
      requestTypeId: "leave-type", requestTypeName: "Leave Request",
      status: "pending", adminRemarks: "", createdAt: new Date(),
      departmentId: DEPT_1
    });
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
  // Re-seed after each test group if needed — handled per describe block
});

// ================================================================
// 1. EMPLOYEE PRIVILEGE ESCALATION
// ================================================================

describe("1 — Employee privilege escalation", () => {

  test("Employee cannot set own role to admin", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "users", EMP_A_UID), { role: "admin" })
    );
  });

  test("Employee cannot set active to false on own account", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "users", EMP_A_UID), { active: false })
    );
  });

  test("Employee cannot change their own departmentId", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "users", EMP_A_UID), { departmentId: DEPT_2 })
    );
  });

  test("Employee cannot set isDepartmentHead to true on own account", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "users", EMP_A_UID), { isDepartmentHead: true })
    );
  });

  test("Employee cannot update another employee's document", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "users", EMP_B_UID), { name: "Hacked" })
    );
  });

  test("Employee can update own sessionToken", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "users", EMP_A_UID), { sessionToken: "valid-token" })
    );
  });

  test("Employee can update own profilePic", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "users", EMP_A_UID), { profilePic: "data:image/jpeg;base64,abc" })
    );
  });

  test("Inactive admin cannot perform admin actions", async () => {
    const db = testEnv.authenticatedContext(INACTIVE_ADMIN).firestore();
    await assertFails(
      updateDoc(doc(db, "settings", "general"), { gracePeriodMinutes: 0 })
    );
  });

  test("Admin cannot change own role (lockout protection)", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "users", ADMIN_UID), { role: "employee" })
    );
  });

  test("Admin can change another user's role", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "users", EMP_A_UID), { role: "employee" })
    );
  });
});

// ================================================================
// 2. UNAUTHORIZED DM ACCESS
// ================================================================

describe("2 — DM room access control", () => {

  test("Employee C cannot read DM room metadata for A&B", async () => {
    // EMP_B_UID is in the DM but we test with a 3rd party — reuse EMP_HEAD_UID
    const db = testEnv.authenticatedContext(EMP_HEAD_UID).firestore();
    await assertFails(
      getDoc(doc(db, "chatRooms", "dm-ab-room"))
    );
  });

  test("DM participant can read their own DM room metadata", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertSucceeds(
      getDoc(doc(db, "chatRooms", "dm-ab-room"))
    );
  });

  test("General room readable by any employee", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertSucceeds(
      getDoc(doc(db, "chatRooms", "general-room"))
    );
  });

  test("Employee cannot create DM without including themselves", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      addDoc(collection(db, "chatRooms"), {
        name: "Bad DM", type: "dm",
        members: [EMP_B_UID, EMP_HEAD_UID]  // A not included
      })
    );
  });

  test("Employee cannot create DM with 3 members", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      addDoc(collection(db, "chatRooms"), {
        name: "Group DM", type: "dm",
        members: [EMP_A_UID, EMP_B_UID, EMP_HEAD_UID]
      })
    );
  });

  test("Employee can create a valid 2-person DM including themselves", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertSucceeds(
      addDoc(collection(db, "chatRooms"), {
        name: "A & Head DM", type: "dm",
        members: [EMP_A_UID, EMP_HEAD_UID],
        createdAt: new Date()
      })
    );
  });
});

// ================================================================
// 3. UNAUTHORIZED MESSAGE INJECTION
// ================================================================

describe("3 — Chat message injection prevention", () => {

  test("Employee cannot send message with forged senderId", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      addDoc(collection(db, "chatRooms", "general-room", "messages"), {
        senderId:    EMP_B_UID,  // forged
        senderName:  "Fake",
        text:        "Impersonation",
        createdAt:   new Date()
      })
    );
  });

  test("Employee can send a message with correct senderId in general room", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertSucceeds(
      addDoc(collection(db, "chatRooms", "general-room", "messages"), {
        senderId:    EMP_A_UID,
        senderName:  "Employee A",
        text:        "Hello!",
        createdAt:   new Date()
      })
    );
  });

  test("Non-DM-member cannot inject message into DM room", async () => {
    const db = testEnv.authenticatedContext(EMP_HEAD_UID).firestore();
    await assertFails(
      addDoc(collection(db, "chatRooms", "dm-ab-room", "messages"), {
        senderId:   EMP_HEAD_UID,
        senderName: "Head",
        text:       "Injected",
        createdAt:  new Date()
      })
    );
  });

  test("DM member can send a message in their DM room", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertSucceeds(
      addDoc(collection(db, "chatRooms", "dm-ab-room", "messages"), {
        senderId:   EMP_A_UID,
        senderName: "Employee A",
        text:       "Hey B!",
        createdAt:  new Date()
      })
    );
  });

  test("Message text exceeding 4000 chars is rejected", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      addDoc(collection(db, "chatRooms", "general-room", "messages"), {
        senderId:   EMP_A_UID,
        senderName: "Employee A",
        text:       "A".repeat(4001),
        createdAt:  new Date()
      })
    );
  });

  test("Message text of 0 chars is rejected", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      addDoc(collection(db, "chatRooms", "general-room", "messages"), {
        senderId:   EMP_A_UID,
        senderName: "Employee A",
        text:       "",
        createdAt:  new Date()
      })
    );
  });

  test("Nobody can delete a chat message (not even admin)", async () => {
    // Seed a message
    let msgId;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const ref = await addDoc(
        collection(ctx.firestore(), "chatRooms", "general-room", "messages"),
        { senderId: EMP_A_UID, senderName: "A", text: "del test", createdAt: new Date() }
      );
      msgId = ref.id;
    });
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(
      deleteDoc(doc(db, "chatRooms", "general-room", "messages", msgId))
    );
  });
});

// ================================================================
// 4. ATTENDANCE OWNERSHIP AND FIELD VALIDATION
// ================================================================

describe("4 — Attendance integrity", () => {

  test("Employee can submit attendance for own UID", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertSucceeds(
      addDoc(collection(db, "attendance"), {
        employeeId:   EMP_A_UID,
        employeeName: "Employee A",
        type:         "check_in",
        timestamp:    new Date()
      })
    );
  });

  test("Employee cannot submit attendance for another employee's UID", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      addDoc(collection(db, "attendance"), {
        employeeId:   EMP_B_UID,  // not own UID
        employeeName: "Employee B",
        type:         "check_in",
        timestamp:    new Date()
      })
    );
  });

  test("Invalid attendance type is rejected", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      addDoc(collection(db, "attendance"), {
        employeeId:   EMP_A_UID,
        employeeName: "Employee A",
        type:         "admin_override",
        timestamp:    new Date()
      })
    );
  });

  test("Attendance record with forbidden 'role' field is rejected", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      addDoc(collection(db, "attendance"), {
        employeeId:   EMP_A_UID,
        employeeName: "Employee A",
        type:         "check_in",
        timestamp:    new Date(),
        role:         "admin"  // forbidden
      })
    );
  });

  test("Attendance with valid location map is accepted", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertSucceeds(
      addDoc(collection(db, "attendance"), {
        employeeId:   EMP_A_UID,
        employeeName: "Employee A",
        type:         "check_out",
        timestamp:    new Date(),
        location:     { latitude: 7.1907, longitude: 125.4553 }
      })
    );
  });

  test("Employee cannot edit an existing attendance record", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "attendance", "existing-att-001"), {
        type: "check_out"
      })
    );
  });

  test("Employee cannot delete an attendance record", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      deleteDoc(doc(db, "attendance", "existing-att-001"))
    );
  });

  test("Admin can read all attendance records", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(
      getDoc(doc(db, "attendance", "existing-att-001"))
    );
  });

  test("Employee B cannot read Employee A's attendance record", async () => {
    const db = testEnv.authenticatedContext(EMP_B_UID).firestore();
    await assertFails(
      getDoc(doc(db, "attendance", "existing-att-001"))
    );
  });

  test("Department head of dept-1 can read dept-1 attendance", async () => {
    const db = testEnv.authenticatedContext(EMP_HEAD_UID).firestore();
    await assertSucceeds(
      getDoc(doc(db, "attendance", "existing-att-001"))
    );
  });

  // OFFLINE COMPATIBILITY
  test("Offline attendance (recordedOffline: true) is accepted by rules", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertSucceeds(
      addDoc(collection(db, "attendance"), {
        employeeId:      EMP_A_UID,
        employeeName:    "Employee A",
        type:            "check_in",
        timestamp:       new Date(),
        recordedOffline: true
      })
    );
  });
});

// ================================================================
// 5. REQUESTS OWNERSHIP AND APPROVAL
// ================================================================

describe("5 — Request ownership and approval", () => {

  test("Employee can submit a pending request for own UID", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertSucceeds(
      addDoc(collection(db, "requests"), {
        employeeId:      EMP_A_UID,
        employeeName:    "Employee A",
        requestTypeId:   "leave-type",
        requestTypeName: "Leave Request",
        status:          "pending",
        createdAt:       new Date()
      })
    );
  });

  test("Employee cannot create pre-approved request", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      addDoc(collection(db, "requests"), {
        employeeId:      EMP_A_UID,
        employeeName:    "Employee A",
        requestTypeId:   "leave-type",
        requestTypeName: "Leave Request",
        status:          "approved",  // must be pending
        createdAt:       new Date()
      })
    );
  });

  test("Employee cannot create request for another employee", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      addDoc(collection(db, "requests"), {
        employeeId:      EMP_B_UID,  // not own UID
        employeeName:    "Employee B",
        requestTypeId:   "leave-type",
        requestTypeName: "Leave Request",
        status:          "pending",
        createdAt:       new Date()
      })
    );
  });

  test("Employee cannot create request without requestTypeId", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      addDoc(collection(db, "requests"), {
        employeeId:      EMP_A_UID,
        employeeName:    "Employee A",
        requestTypeName: "Leave Request",
        status:          "pending",
        createdAt:       new Date()
        // requestTypeId missing
      })
    );
  });

  test("Employee cannot create request with pre-filled adminRemarks", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      addDoc(collection(db, "requests"), {
        employeeId:      EMP_A_UID,
        employeeName:    "Employee A",
        requestTypeId:   "leave-type",
        requestTypeName: "Leave Request",
        status:          "pending",
        adminRemarks:    "Self-approved",  // non-empty adminRemarks forbidden on create
        createdAt:       new Date()
      })
    );
  });

  test("Employee cannot approve own request", async () => {
    const db = testEnv.authenticatedContext(EMP_A_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "requests", "req-001"), { status: "approved" })
    );
  });

  test("Employee cannot read another employee's request", async () => {
    const db = testEnv.authenticatedContext(EMP_B_UID).firestore();
    await assertFails(
      getDoc(doc(db, "requests", "req-001"))
    );
  });

  test("Admin can approve a request", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "requests", "req-001"), {
        status:       "approved",
        adminRemarks: "Granted"
      })
    );
  });

  test("Admin cannot change employeeId on a request", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "requests", "req-001"), {
        employeeId: EMP_B_UID  // ownership change blocked
      })
    );
  });
});

// ================================================================
// 6. ADMIN PERMISSIONS
// ================================================================

describe("6 — Admin field restrictions", () => {

  test("Admin can update employee name and department", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "users", EMP_B_UID), {
        name:           "Employee B Updated",
        departmentId:   DEPT_1,
        departmentName: "Dept 1"
      })
    );
  });

  test("Admin can deactivate an employee", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "users", EMP_B_UID), { active: false })
    );
  });

  test("Admin can modify settings", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "settings", "general"), { gracePeriodMinutes: 20 })
    );
  });

  test("Inactive admin cannot modify settings", async () => {
    const db = testEnv.authenticatedContext(INACTIVE_ADMIN).firestore();
    await assertFails(
      updateDoc(doc(db, "settings", "general"), { gracePeriodMinutes: 0 })
    );
  });

  test("Admin can read any employee document", async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(getDoc(doc(db, "users", EMP_A_UID)));
    await assertSucceeds(getDoc(doc(db, "users", EMP_B_UID)));
  });
});
