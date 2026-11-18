/**
 * Chat module — shared by both employee.html and admin.html.
 *
 * Firestore structure:
 *   chatRooms/{roomId}
 *     name:         string
 *     type:         "general" | "department" | "dm"
 *     departmentId: string | null
 *     members:      [uid, uid]   (DM only)
 *     createdAt:    timestamp
 *
 *   chatRooms/{roomId}/messages/{msgId}
 *     senderId:         string
 *     senderName:       string
 *     senderDepartment: string
 *     senderInitials:   string
 *     text:             string
 *     createdAt:        timestamp
 */

/* ------------------------------------------------------------------ */
/*  State                                                               */
/* ------------------------------------------------------------------ */
let _chatUser       = null;
let _chatRooms      = [];
let _activeRoomId   = null;
let _msgUnsubscribe = null;
let _unreadCounts   = {};
let _allUsers       = [];      // for DM search
let _totalUnread    = 0;       // global unread count for badge

/* ------------------------------------------------------------------ */
/*  Bootstrap                                                           */
/* ------------------------------------------------------------------ */
async function initChat(user) {
  _chatUser = user;
  await _ensureGeneralRoom();
  await _loadRooms();
  await _loadAllUsers();
  _renderRoomList();

  if (_chatRooms.length > 0) openRoom(_chatRooms[0].id);

  const input = document.getElementById("chatInput");
  const btn   = document.getElementById("chatSendBtn");
  if (btn)   btn.addEventListener("click", sendMessage);
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
    });
  }

  // Wire up DM search
  const searchInput = document.getElementById("dmSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", _renderDmSearch);
  }

  // Start background listeners for ALL rooms to count unread
  _startUnreadListeners();
}

/* ------------------------------------------------------------------ */
/*  Ensure general room exists                                         */
/* ------------------------------------------------------------------ */
async function _ensureGeneralRoom() {
  try {
    const snap = await db.collection("chatRooms").where("type", "==", "general").limit(1).get();
    if (snap.empty) {
      await db.collection("chatRooms").add({
        name: "General", type: "general", departmentId: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (err) { console.error("_ensureGeneralRoom:", err); }
}

/* ------------------------------------------------------------------ */
/*  Load rooms                                                         */
/* ------------------------------------------------------------------ */
async function _loadRooms() {
  try {
    const snap = await db.collection("chatRooms").get();
    const all  = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Sort: general first, then departments, then DMs
    const sorted = all.sort((a, b) => {
      const order = { general: 0, department: 1, dm: 2 };
      const diff = (order[a.type] || 0) - (order[b.type] || 0);
      return diff !== 0 ? diff : (a.name || "").localeCompare(b.name || "");
    });

    if (_chatUser.role === "admin") {
      // Admin sees general + all departments + DMs they're part of
      _chatRooms = sorted.filter(
        (r) => r.type !== "dm" || (r.members && r.members.includes(_chatUser.uid))
      );
    } else {
      _chatRooms = sorted.filter(
        (r) => r.type === "general" ||
               (r.type === "department" && r.departmentId === _chatUser.departmentId) ||
               (r.type === "dm" && r.members && r.members.includes(_chatUser.uid))
      );
    }
  } catch (err) { console.error("_loadRooms:", err); }
}

/* ------------------------------------------------------------------ */
/*  Load all users (for DM search)                                     */
/* ------------------------------------------------------------------ */
async function _loadAllUsers() {
  try {
    const snap = await db.collection("users").where("active", "!=", false).get();
    _allUsers = snap.docs
      .map((d) => ({ uid: d.id, ...d.data() }))
      .filter((u) => u.uid !== _chatUser.uid); // exclude self
  } catch (err) { console.error("_loadAllUsers:", err); }
}

/* ------------------------------------------------------------------ */
/*  Render room list sidebar                                           */
/* ------------------------------------------------------------------ */
function _renderRoomList() {
  const list = document.getElementById("chatRoomList");
  if (!list) return;

  const grouped = {
    general:    _chatRooms.filter((r) => r.type === "general"),
    department: _chatRooms.filter((r) => r.type === "department"),
    dm:         _chatRooms.filter((r) => r.type === "dm")
  };

  let html = "";

  // General
  grouped.general.forEach((r) => {
    html += _roomItemHtml(r, "# ");
  });

  // Departments
  if (grouped.department.length) {
    html += `<div class="chat-rooms__title" style="margin-top:12px;">Departments</div>`;
    grouped.department.forEach((r) => html += _roomItemHtml(r, "# "));
  }

  // DMs
  if (grouped.dm.length) {
    html += `<div class="chat-rooms__title" style="margin-top:12px;">Direct Messages</div>`;
    grouped.dm.forEach((r) => {
      // Show the other person's name
      const otherUid  = r.members?.find((m) => m !== _chatUser.uid);
      const otherUser = _allUsers.find((u) => u.uid === otherUid);
      const label     = otherUser ? otherUser.name : r.name || "DM";
      html += _roomItemHtml(r, "", label);
    });
  }

  // DM search section
  html += `
    <div class="chat-rooms__title" style="margin-top:12px;">New Message</div>
    <div style="padding:0 8px 8px;">
      <input type="text" id="dmSearchInput" placeholder="Search people..."
        style="width:100%;padding:7px 10px;border-radius:6px;border:none;
               background:rgba(255,255,255,.12);color:#fff;font-size:.8rem;outline:none;" />
    </div>
    <div id="dmSearchResults"></div>
  `;

  list.innerHTML = html;

  // Re-wire search after re-render
  const searchInput = document.getElementById("dmSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", _renderDmSearch);
  }
}

function _roomItemHtml(r, prefix = "", overrideLabel = null) {
  const unread = _unreadCounts[r.id] || 0;
  const label  = overrideLabel || r.name;
  return `
    <button class="chat-room-item ${r.id === _activeRoomId ? "active" : ""}"
            onclick="openRoom('${r.id}')" id="chatRoom_${r.id}">
      <span class="chat-room-item__name">${escapeHtml(prefix + label)}</span>
      ${unread ? `<span class="chat-room-item__badge">${unread}</span>` : ""}
    </button>
  `;
}

/* ------------------------------------------------------------------ */
/*  DM user search                                                     */
/* ------------------------------------------------------------------ */
function _renderDmSearch() {
  const query   = (document.getElementById("dmSearchInput")?.value || "").toLowerCase().trim();
  const results = document.getElementById("dmSearchResults");
  if (!results) return;

  if (!query) { results.innerHTML = ""; return; }

  const matches = _allUsers.filter(
    (u) => u.name?.toLowerCase().includes(query) ||
           u.email?.toLowerCase().includes(query) ||
           u.departmentName?.toLowerCase().includes(query)
  ).slice(0, 8);

  if (!matches.length) {
    results.innerHTML = `<div style="padding:8px 16px;color:rgba(255,255,255,.4);font-size:.78rem;">No users found</div>`;
    return;
  }

  results.innerHTML = matches.map((u) => `
    <button class="chat-room-item" onclick="openDM('${u.uid}')"
            style="flex-direction:column;align-items:flex-start;gap:0;padding:8px 16px;">
      <span style="font-size:.85rem;color:#fff;font-weight:600;">${escapeHtml(u.name)}</span>
      <span style="font-size:.72rem;color:rgba(255,255,255,.5);">${escapeHtml(u.departmentName || u.role || "")}</span>
    </button>
  `).join("");
}

/* ------------------------------------------------------------------ */
/*  Open or create a DM room                                           */
/* ------------------------------------------------------------------ */
async function openDM(otherUid) {
  // Clear search
  const si = document.getElementById("dmSearchInput");
  const sr = document.getElementById("dmSearchResults");
  if (si) si.value = "";
  if (sr) sr.innerHTML = "";

  // Check if DM room already exists between these two users
  const existing = _chatRooms.find(
    (r) => r.type === "dm" && r.members?.includes(_chatUser.uid) && r.members?.includes(otherUid)
  );

  if (existing) {
    openRoom(existing.id);
    return;
  }

  // Create new DM room
  try {
    const otherUser = _allUsers.find((u) => u.uid === otherUid);
    const dmName    = `${_chatUser.name} & ${otherUser?.name || "User"}`;

    const ref = await db.collection("chatRooms").add({
      name:    dmName,
      type:    "dm",
      members: [_chatUser.uid, otherUid],
      departmentId: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Reload rooms and open the new one
    await _loadRooms();
    _renderRoomList();
    openRoom(ref.id);
  } catch (err) {
    showToast("Failed to open direct message.", "error");
    console.error("openDM:", err);
  }
}

/* ------------------------------------------------------------------ */
/*  Open a room                                                        */
/* ------------------------------------------------------------------ */
function openRoom(roomId) {
  const room = _chatRooms.find((r) => r.id === roomId);
  if (!room) return;

  _activeRoomId = roomId;
  _unreadCounts[roomId] = 0;
  _setLastSeen(roomId);
  _updateGlobalBadge();
  _renderRoomList();

  // Header
  const header = document.getElementById("chatRoomName");
  const sub    = document.getElementById("chatRoomSub");
  if (header) {
    if (room.type === "dm") {
      const otherUid  = room.members?.find((m) => m !== _chatUser.uid);
      const otherUser = _allUsers.find((u) => u.uid === otherUid);
      header.textContent = otherUser ? otherUser.name : room.name;
    } else {
      header.textContent = room.name;
    }
  }
  if (sub) {
    const labels = { general: "Company-wide", department: "Department channel", dm: "Direct Message" };
    sub.textContent = labels[room.type] || "";
  }

  // Messages area
  const msgs = document.getElementById("chatMessages");
  if (msgs) msgs.innerHTML = `<div class="chat-loading">
    <span class="spinner" style="border-color:rgba(0,0,0,.1);border-top-color:var(--primary)"></span> Loading...
  </div>`;

  if (_msgUnsubscribe) { _msgUnsubscribe(); _msgUnsubscribe = null; }

  _msgUnsubscribe = db
    .collection("chatRooms").doc(roomId)
    .collection("messages")
    .orderBy("createdAt", "asc")
    .limitToLast(100)
    .onSnapshot(
      (snap) => _renderMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err)  => console.error("Messages listener:", err)
    );

  const input = document.getElementById("chatInput");
  const btn   = document.getElementById("chatSendBtn");
  if (input) { input.disabled = false; input.focus(); }
  if (btn)   btn.disabled = false;
}

/* ------------------------------------------------------------------ */
/*  Render messages                                                    */
/* ------------------------------------------------------------------ */
function _renderMessages(messages) {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  if (!messages.length) { container.innerHTML = ""; return; }

  let html = "";
  let lastDate     = null;
  let lastSenderId = null;

  messages.forEach((msg) => {
    const ts        = msg.createdAt?.toDate ? msg.createdAt.toDate() : new Date();
    const dateLabel = ts.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

    if (dateLabel !== lastDate) {
      html += `<div class="chat-date-sep">${escapeHtml(dateLabel)}</div>`;
      lastDate     = dateLabel;
      lastSenderId = null;
    }

    const isMe     = msg.senderId === _chatUser.uid;
    const isSystem = msg.type === "system";

    if (isSystem) {
      html += `<div class="chat-system-msg">${escapeHtml(msg.text)}</div>`;
      lastSenderId = null;
      return;
    }

    const groupClass = isMe ? "mine" : "theirs";
    const showMeta   = !isMe && lastSenderId !== msg.senderId;
    const initials   = msg.senderInitials || _initials(msg.senderName || "?");
    const timeStr    = ts.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

    // Show name + department for group/general rooms
    const activeRoom = _chatRooms.find((r) => r.id === _activeRoomId);
    const isDM       = activeRoom?.type === "dm";

    const senderLabel = msg.senderDepartment && !isDM
      ? `${escapeHtml(msg.senderName)} <span class="chat-dept-tag">${escapeHtml(msg.senderDepartment)}</span>`
      : escapeHtml(msg.senderName);

    html += `
      <div class="chat-msg-group ${groupClass}">
        ${showMeta
          ? `<div class="chat-avatar" style="background:${_avatarColor(msg.senderId)}">${escapeHtml(initials)}</div>`
          : `<div style="width:30px;flex-shrink:0"></div>`
        }
        <div class="chat-bubble-stack">
          ${showMeta ? `<div class="chat-sender-name">${senderLabel}</div>` : ""}
          <div class="chat-bubble">
            ${escapeHtml(msg.text)}
            <div class="chat-bubble__time">${timeStr}</div>
          </div>
        </div>
      </div>
    `;

    lastSenderId = msg.senderId;
  });

  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

/* ------------------------------------------------------------------ */
/*  Send a message                                                     */
/* ------------------------------------------------------------------ */
async function sendMessage() {
  if (!_activeRoomId || !_chatUser) return;

  const input = document.getElementById("chatInput");
  const text  = input?.value.trim();
  if (!text) return;

  input.value = "";
  input.style.height = "auto";

  try {
    await db.collection("chatRooms").doc(_activeRoomId)
      .collection("messages").add({
        senderId:         _chatUser.uid,
        senderName:       _chatUser.name,
        senderDepartment: _chatUser.departmentName || "",
        senderInitials:   _initials(_chatUser.name),
        text:             text,
        createdAt:        firebase.firestore.FieldValue.serverTimestamp()
      });
  } catch (err) {
    showToast("Failed to send message.", "error");
    if (input) input.value = text;
  }
}

/* ------------------------------------------------------------------ */
/*  Dept room management (called from admin.js)                       */
/* ------------------------------------------------------------------ */
async function createDeptChatRoom(deptId, deptName) {
  try {
    const existing = await db.collection("chatRooms")
      .where("type", "==", "department").where("departmentId", "==", deptId).limit(1).get();
    if (!existing.empty) return;
    await db.collection("chatRooms").add({
      name: deptName, type: "department", departmentId: deptId,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) { console.error("createDeptChatRoom:", err); }
}

async function renameDeptChatRoom(deptId, newName) {
  try {
    const snap = await db.collection("chatRooms")
      .where("type", "==", "department").where("departmentId", "==", deptId).limit(1).get();
    if (!snap.empty) await snap.docs[0].ref.update({ name: newName });
  } catch (err) { console.error("renameDeptChatRoom:", err); }
}

async function deleteDeptChatRoom(deptId) {
  try {
    const snap = await db.collection("chatRooms")
      .where("type", "==", "department").where("departmentId", "==", deptId).limit(1).get();
    if (!snap.empty) await snap.docs[0].ref.delete();
  } catch (err) { console.error("deleteDeptChatRoom:", err); }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function _initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return parts.length === 1
    ? parts[0][0].toUpperCase()
    : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function _avatarColor(uid) {
  const colors = ["#16a34a","#15803d","#0284c7","#0369a1","#7c3aed","#b45309","#dc2626","#0f766e"];
  let hash = 0;
  for (let i = 0; i < (uid || "").length; i++) {
    hash = (hash << 5) - hash + uid.charCodeAt(i);
    hash |= 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

function destroyChat() {
  if (_msgUnsubscribe) { _msgUnsubscribe(); _msgUnsubscribe = null; }
}

/* ------------------------------------------------------------------ */
/*  Unread tracking & notification badge                               */
/* ------------------------------------------------------------------ */

const _unreadUnsubs = []; // background room listeners
const _lastSeenKey  = "chat_last_seen"; // localStorage key prefix

/**
 * Start a lightweight background listener on every accessible room.
 * Tracks messages newer than the last time each room was opened.
 */
function _startUnreadListeners() {
  _chatRooms.forEach((room) => {
    const lastSeen = _getLastSeen(room.id);

    const unsub = db
      .collection("chatRooms").doc(room.id)
      .collection("messages")
      .orderBy("createdAt", "desc")
      .limit(30)
      .onSnapshot((snap) => {
        // Count messages newer than lastSeen that aren't from me
        let count = 0;
        snap.docs.forEach((d) => {
          const msg = d.data();
          if (msg.senderId === _chatUser.uid) return; // my own message
          const ts = msg.createdAt?.toDate?.()?.getTime() || 0;
          if (ts > lastSeen) count++;
        });

        // Only count unread for rooms that aren't currently open
        _unreadCounts[room.id] = room.id === _activeRoomId ? 0 : count;

        _updateGlobalBadge();
        _renderRoomList();
      }, () => { /* ignore errors on background listeners */ });

    _unreadUnsubs.push(unsub);
  });
}

/** Persist the last-seen timestamp for a room in localStorage. */
function _setLastSeen(roomId) {
  try {
    const key = `${_lastSeenKey}_${roomId}`;
    localStorage.setItem(key, Date.now().toString());
  } catch (_) {}
}

/** Get the last-seen timestamp for a room from localStorage. */
function _getLastSeen(roomId) {
  try {
    const key = `${_lastSeenKey}_${roomId}`;
    return parseInt(localStorage.getItem(key) || "0", 10);
  } catch (_) { return 0; }
}

/**
 * Sum all unread counts and update the Chat tab / sidebar badge.
 * Works for both employee (tab bar badge) and admin (sidebar badge).
 */
function _updateGlobalBadge() {
  _totalUnread = Object.values(_unreadCounts).reduce((a, b) => a + b, 0);

  const badge = document.getElementById("chatTabBadge");
  if (!badge) return;

  if (_totalUnread > 0) {
    badge.textContent = _totalUnread > 99 ? "99+" : _totalUnread;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function destroyChat() {
  if (_msgUnsubscribe) { _msgUnsubscribe(); _msgUnsubscribe = null; }
  _unreadUnsubs.forEach((u) => u());
  _unreadUnsubs.length = 0;
}
