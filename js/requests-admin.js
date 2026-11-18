/**
 * Admin — Request Types management & Inbox review.
 *
 * Firestore collections:
 *   requestTypes/{id}  — type definitions with custom fields
 *   requests/{id}      — individual submissions from employees
 */

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */
let _reqTypes   = [];   // all request type definitions
let _requests   = [];   // loaded inbox records
let _reviewId   = null; // request doc id currently being reviewed
let _fieldCount = 0;    // counter for unique field IDs in builder
let _reqUnsubs  = {};   // real-time listener unsubscribers

/* ------------------------------------------------------------------ */
/* Bootstrap — called once admin page is ready                        */
/* ------------------------------------------------------------------ */
async function initRequests() {
  await loadReqTypes();
  await loadRequests();
  populateReqFilterSelects();

  _overlayClick("reqTypeModalOverlay", closeReqTypeModal);
  _overlayClick("reqReviewOverlay",    closeReqReview);

  document.getElementById("reqTypeForm").addEventListener("submit", saveReqType);
}

/* ------------------------------------------------------------------ */
/* Tab switching                                                       */
/* ------------------------------------------------------------------ */
function switchReqTab(tab) {
  const inbox = document.getElementById("reqPanelInbox");
  const types = document.getElementById("reqPanelTypes");
  const tabInbox = document.getElementById("rtabInbox");
  const tabTypes = document.getElementById("rtabTypes");

  if (tab === "inbox") {
    inbox.classList.remove("hidden");
    types.classList.add("hidden");
    tabInbox.classList.add("active");
    tabTypes.classList.remove("active");
  } else {
    inbox.classList.add("hidden");
    types.classList.remove("hidden");
    tabInbox.classList.remove("active");
    tabTypes.classList.add("active");
    renderReqTypes();
  }
}

/* ================================================================== */
/*  Request Types                                                      */
/* ================================================================== */

async function loadReqTypes() {
  try {
    const snap = await db.collection("requestTypes").orderBy("name").get();
    _reqTypes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderReqTypes();
    populateReqFilterSelects();
  } catch (err) {
    console.error("loadReqTypes:", err);
  }
}

function renderReqTypes() {
  const body = document.getElementById("reqTypesBody");
  if (!_reqTypes.length) {
    body.innerHTML = `<tr><td colspan="5" class="text-center text-light">
      No request types yet. Click "+ Add Request Type" to create one.</td></tr>`;
    return;
  }

  body.innerHTML = _reqTypes.map((t) => {
    const fieldNames = (t.fields || []).map((f) => escapeHtml(f.label)).join(", ") || "—";
    const activeBadge = t.active !== false
      ? '<span class="badge badge--success">Active</span>'
      : '<span class="badge badge--gray">Inactive</span>';
    return `<tr>
      <td><strong>${escapeHtml(t.name)}</strong></td>
      <td class="text-sm">${escapeHtml(t.description || "—")}</td>
      <td class="text-sm">${fieldNames}</td>
      <td>${activeBadge}</td>
      <td class="flex gap-2">
        <button class="btn btn--secondary btn--sm" onclick="editReqType('${t.id}')">Edit</button>
        <button class="btn btn--danger btn--sm" onclick="deleteReqType('${t.id}')">Delete</button>
      </td>
    </tr>`;
  }).join("");
}

/* ---- Request Type Modal ---- */

function openReqTypeModal() {
  document.getElementById("reqTypeForm").reset();
  document.getElementById("reqTypeId").value = "";
  document.getElementById("reqTypeModalTitle").textContent = "Add Request Type";
  document.getElementById("reqFieldsList").innerHTML = "";
  _fieldCount = 0;
  _showOverlay("reqTypeModalOverlay");
}

function closeReqTypeModal() {
  _hideOverlay("reqTypeModalOverlay");
}

function editReqType(id) {
  const t = _reqTypes.find((r) => r.id === id);
  if (!t) return;

  document.getElementById("reqTypeId").value   = t.id;
  document.getElementById("reqTypeName").value  = t.name;
  document.getElementById("reqTypeDesc").value  = t.description || "";
  document.getElementById("reqTypeActive").value = t.active !== false ? "true" : "false";
  document.getElementById("reqTypeModalTitle").textContent = "Edit Request Type";

  // Rebuild field list
  const list = document.getElementById("reqFieldsList");
  list.innerHTML = "";
  _fieldCount = 0;
  (t.fields || []).forEach((f) => addReqField(f));

  _showOverlay("reqTypeModalOverlay");
}

async function deleteReqType(id) {
  if (!confirm("Delete this request type? Existing requests of this type will remain but the type won't be available for new submissions.")) return;
  try {
    await db.collection("requestTypes").doc(id).delete();
    showToast("Request type deleted.", "success");
    await loadReqTypes();
  } catch (err) {
    showToast("Failed to delete.", "error");
  }
}

async function saveReqType(e) {
  e.preventDefault();
  const btn = document.getElementById("reqTypeSaveBtn");
  const id   = document.getElementById("reqTypeId").value;
  const name = document.getElementById("reqTypeName").value.trim();
  const desc = document.getElementById("reqTypeDesc").value.trim();
  const active = document.getElementById("reqTypeActive").value === "true";

  // Collect fields from builder
  const fieldRows = document.querySelectorAll(".req-field-row");
  const fields = [];
  let valid = true;
  fieldRows.forEach((row) => {
    const label = row.querySelector(".rfl-label").value.trim();
    const type  = row.querySelector(".rfl-type").value;
    const req   = row.querySelector(".rfl-required").checked;
    if (!label) { valid = false; return; }
    fields.push({ label, type, required: req });
  });

  if (!valid) {
    showToast("All field labels are required.", "warning");
    return;
  }

  showLoading(btn, "Saving...");
  try {
    const data = {
      name, description: desc, active, fields,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (id) {
      await db.collection("requestTypes").doc(id).update(data);
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection("requestTypes").add(data);
    }

    showToast("Request type saved.", "success");
    closeReqTypeModal();
    await loadReqTypes();
  } catch (err) {
    showToast(err.message || "Failed to save.", "error");
  } finally {
    hideLoading(btn);
  }
}

/* ---- Field builder ---- */

function addReqField(existing = null) {
  _fieldCount++;
  const idx = _fieldCount;
  const list = document.getElementById("reqFieldsList");

  const row = document.createElement("div");
  row.className = "req-field-row";
  row.dataset.idx = idx;

  row.innerHTML = `
    <div class="req-field-row__inputs">
      <input type="text" class="rfl-label" placeholder="Field label (e.g. Start Date)"
        value="${existing ? escapeHtml(existing.label) : ""}" />
      <select class="rfl-type">
        <option value="text"      ${existing?.type === "text"      ? "selected" : ""}>Short text</option>
        <option value="textarea"  ${existing?.type === "textarea"  ? "selected" : ""}>Long text</option>
        <option value="date"      ${existing?.type === "date"      ? "selected" : ""}>Date</option>
        <option value="number"    ${existing?.type === "number"    ? "selected" : ""}>Number</option>
        <option value="select"    ${existing?.type === "select"    ? "selected" : ""}>Dropdown</option>
      </select>
      <label class="req-field-row__req">
        <input type="checkbox" class="rfl-required" ${existing?.required ? "checked" : ""} />
        Required
      </label>
      <button type="button" class="btn btn--ghost btn--sm" onclick="removeReqField(${idx})">Remove</button>
    </div>
    <div class="req-field-row__options" id="rfOpts${idx}">
      ${existing?.type === "select" ? _renderSelectOptions(existing.options || [], idx) : ""}
    </div>
  `;

  // Show/hide options input when type changes
  row.querySelector(".rfl-type").addEventListener("change", (e) => {
    const opts = document.getElementById(`rfOpts${idx}`);
    opts.innerHTML = e.target.value === "select"
      ? _renderSelectOptions([], idx)
      : "";
  });

  list.appendChild(row);
}

function _renderSelectOptions(existing, idx) {
  return `<div class="form-hint" style="margin-top:6px">
    Options (comma-separated):
    <input type="text" class="rfl-options" style="margin-top:4px;width:100%"
      placeholder="e.g. Annual Leave, Sick Leave, Emergency"
      value="${existing.join(", ")}" />
  </div>`;
}

function removeReqField(idx) {
  const row = document.querySelector(`.req-field-row[data-idx="${idx}"]`);
  if (row) row.remove();
}

/* ================================================================== */
/*  Requests Inbox                                                     */
/* ================================================================== */

async function loadRequests() {
  const body = document.getElementById("reqInboxBody");
  body.innerHTML = `<tr><td colspan="8" class="text-center text-light">Loading...</td></tr>`;

  // Detach previous listener
  if (_reqUnsubs.requests) { _reqUnsubs.requests(); _reqUnsubs.requests = null; }

  const statusFilter = document.getElementById("reqFilterStatus")?.value || "";
  const typeFilter   = document.getElementById("reqFilterType")?.value   || "";
  const deptFilter   = document.getElementById("reqFilterDept")?.value   || "";

  _reqUnsubs.requests = db.collection("requests")
    .orderBy("createdAt", "desc").limit(200)
    .onSnapshot((snap) => {
      let records = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      if (statusFilter) records = records.filter((r) => r.status === statusFilter);
      if (typeFilter)   records = records.filter((r) => r.requestTypeId === typeFilter);
      if (deptFilter)   records = records.filter((r) => r.departmentId  === deptFilter);

      _requests = records;

      if (!records.length) {
        body.innerHTML = `<tr><td colspan="8" class="text-center text-light">No requests found.</td></tr>`;
        return;
      }

      body.innerHTML = records.map((r) => {
        const statusBadge = _reqStatusBadge(r.status);
        const details = r.fieldValues
          ? Object.entries(r.fieldValues)
              .map(([k, v]) => `<div><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}</div>`)
              .join("")
          : "—";
        const actionBtns = r.status === "pending"
          ? `<button class="btn btn--primary btn--sm" onclick="openReqReview('${r.id}')">Review</button>`
          : `<button class="btn btn--secondary btn--sm" onclick="openReqReview('${r.id}')">View</button>`;

        return `<tr>
          <td class="text-sm">${formatDate(r.createdAt)}</td>
          <td><strong>${escapeHtml(r.employeeName)}</strong></td>
          <td class="text-sm">${escapeHtml(r.departmentName || "—")}</td>
          <td><span class="badge badge--info">${escapeHtml(r.requestTypeName)}</span></td>
          <td class="text-sm">${details}</td>
          <td class="text-sm">${escapeHtml(r.notes || "—")}</td>
          <td>${statusBadge}</td>
          <td>${actionBtns}</td>
        </tr>`;
      }).join("");
    }, (err) => {
      console.error("loadRequests:", err);
      body.innerHTML = `<tr><td colspan="8" class="text-center text-light">Error loading requests.</td></tr>`;
    });
}

function _reqStatusBadge(status) {
  const map = {
    pending:  '<span class="badge badge--warning">Pending</span>',
    approved: '<span class="badge badge--success">Approved</span>',
    denied:   '<span class="badge badge--danger">Denied</span>'
  };
  return map[status] || '<span class="badge badge--gray">Unknown</span>';
}

function resetReqFilters() {
  document.getElementById("reqFilterStatus").value = "";
  document.getElementById("reqFilterType").value   = "";
  document.getElementById("reqFilterDept").value   = "";
  loadRequests();
}

function populateReqFilterSelects() {
  // Type filter
  const typeOpts = '<option value="">All</option>' +
    _reqTypes.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
  const typeEl = document.getElementById("reqFilterType");
  if (typeEl) typeEl.innerHTML = typeOpts;

  // Dept filter (reuse _departments from admin.js)
  const deptOpts = '<option value="">All</option>' +
    (_departments || []).map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join("");
  const deptEl = document.getElementById("reqFilterDept");
  if (deptEl) deptEl.innerHTML = deptOpts;
}

/* ---- Review modal ---- */

function openReqReview(id) {
  const req = _requests.find((r) => r.id === id);
  if (!req) return;
  _reviewId = id;

  const details = req.fieldValues
    ? Object.entries(req.fieldValues).map(([k, v]) =>
        `<div class="req-detail-row"><span class="req-detail-key">${escapeHtml(k)}</span>
         <span>${escapeHtml(String(v))}</span></div>`
      ).join("")
    : "";

  document.getElementById("reqReviewContent").innerHTML = `
    <div class="req-review-meta">
      <div><strong>Employee:</strong> ${escapeHtml(req.employeeName)}</div>
      <div><strong>Department:</strong> ${escapeHtml(req.departmentName || "—")}</div>
      <div><strong>Request Type:</strong> ${escapeHtml(req.requestTypeName)}</div>
      <div><strong>Date Filed:</strong> ${formatDateTime(req.createdAt)}</div>
      <div><strong>Status:</strong> ${_reqStatusBadge(req.status)}</div>
    </div>
    ${details ? `<div class="req-detail-block mt-4">${details}</div>` : ""}
    ${req.notes ? `<div class="mt-3"><strong>Notes:</strong> <span class="text-light">${escapeHtml(req.notes)}</span></div>` : ""}
    ${req.adminRemarks ? `<div class="mt-3"><strong>Previous Remarks:</strong> <span class="text-light">${escapeHtml(req.adminRemarks)}</span></div>` : ""}
  `;

  document.getElementById("reqReviewRemarks").value = req.adminRemarks || "";

  // Hide approve/deny buttons if already resolved
  const footer = document.querySelector("#reqReviewOverlay .modal__footer");
  const approveBtn = footer.querySelector(".btn--success");
  const denyBtn    = footer.querySelector(".btn--danger");
  const isPending  = req.status === "pending";
  approveBtn.style.display = isPending ? "" : "none";
  denyBtn.style.display    = isPending ? "" : "none";

  _showOverlay("reqReviewOverlay");
}

function closeReqReview() {
  _hideOverlay("reqReviewOverlay");
}

async function submitReqDecision(decision) {
  if (!_reviewId) return;
  const remarks = document.getElementById("reqReviewRemarks").value.trim();

  try {
    await db.collection("requests").doc(_reviewId).update({
      status: decision,
      adminRemarks: remarks,
      reviewedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    showToast(`Request ${decision}.`, decision === "approved" ? "success" : "warning");
    closeReqReview();
    await loadRequests();
  } catch (err) {
    showToast("Failed to update request.", "error");
  }
}

/* ------------------------------------------------------------------ */
/* initRequests is called directly from admin.js after data loads.    */
/* ------------------------------------------------------------------ */
