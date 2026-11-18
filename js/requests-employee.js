/**
 * Employee — submit and track requests.
 *
 * Loaded after employee.js. Relies on _user being set by employee.js.
 */

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */
let _availableReqTypes = [];

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */
async function initEmployeeRequests() {
  await loadAvailableReqTypes();
  await loadMyRequests();

  document.getElementById("newRequestOverlay")
    .addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeNewRequestModal();
    });

  document.getElementById("newRequestForm")
    .addEventListener("submit", submitRequest);
}

/* ------------------------------------------------------------------ */
/* Load available request types                                        */
/* ------------------------------------------------------------------ */
async function loadAvailableReqTypes() {
  try {
    const snap = await db.collection("requestTypes")
      .where("active", "==", true)
      .get();

    _availableReqTypes = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    // Populate the type dropdown in the modal
    const select = document.getElementById("reqType");
    select.innerHTML = '<option value="">— Select a request type —</option>' +
      _availableReqTypes.map((t) =>
        `<option value="${t.id}">${escapeHtml(t.name)}</option>`
      ).join("");
  } catch (err) {
    console.error("loadAvailableReqTypes:", err);
  }
}

/* ------------------------------------------------------------------ */
/* Render dynamic fields when employee picks a type                   */
/* ------------------------------------------------------------------ */
function renderRequestFields() {
  const typeId  = document.getElementById("reqType").value;
  const container = document.getElementById("reqDynamicFields");
  container.innerHTML = "";

  if (!typeId) return;

  const type = _availableReqTypes.find((t) => t.id === typeId);
  if (!type || !type.fields?.length) return;

  // Show description if present
  if (type.description) {
    const desc = document.createElement("div");
    desc.className = "form-hint mb-3";
    desc.textContent = type.description;
    container.appendChild(desc);
  }

  type.fields.forEach((field) => {
    const group = document.createElement("div");
    group.className = "form-group";

    const label = document.createElement("label");
    label.textContent = field.label + (field.required ? " *" : "");
    group.appendChild(label);

    let input;
    switch (field.type) {
      case "textarea":
        input = document.createElement("textarea");
        input.rows = 3;
        break;
      case "date":
        input = document.createElement("input");
        input.type = "date";
        break;
      case "number":
        input = document.createElement("input");
        input.type = "number";
        break;
      case "select":
        input = document.createElement("select");
        input.innerHTML = '<option value="">— Select —</option>' +
          (field.options || []).map((o) =>
            `<option value="${escapeHtml(o.trim())}">${escapeHtml(o.trim())}</option>`
          ).join("");
        break;
      default: // text
        input = document.createElement("input");
        input.type = "text";
    }

    input.dataset.fieldLabel = field.label;
    input.className = "req-dynamic-input";
    if (field.required) input.required = true;
    input.placeholder = field.label;

    group.appendChild(input);
    container.appendChild(group);
  });
}

/* ------------------------------------------------------------------ */
/* Submit a new request                                                */
/* ------------------------------------------------------------------ */
async function submitRequest(e) {
  e.preventDefault();
  const btn = document.getElementById("reqSubmitBtn");

  const typeId = document.getElementById("reqType").value;
  const notes  = document.getElementById("reqNotes").value.trim();

  if (!typeId) {
    showToast("Please select a request type.", "warning");
    return;
  }

  // Collect dynamic field values
  const inputs = document.querySelectorAll(".req-dynamic-input");
  const fieldValues = {};
  let allValid = true;

  inputs.forEach((input) => {
    const val = input.value.trim();
    if (input.required && !val) {
      allValid = false;
      input.style.borderColor = "var(--danger)";
    } else {
      input.style.borderColor = "";
      fieldValues[input.dataset.fieldLabel] = val;
    }
  });

  if (!allValid) {
    showToast("Please fill in all required fields.", "warning");
    return;
  }

  const type = _availableReqTypes.find((t) => t.id === typeId);

  showLoading(btn, "Submitting...");

  try {
    await db.collection("requests").add({
      employeeId:      auth.currentUser.uid,  // always from Auth, never from client input
      employeeName:    _user.name,
      departmentId:    _user.departmentId   || null,
      departmentName:  _user.departmentName || "",
      requestTypeId:   typeId,
      requestTypeName: type.name,
      fieldValues:     fieldValues,
      notes:           notes,
      status:          "pending",
      adminRemarks:    "",
      createdAt:       firebase.firestore.FieldValue.serverTimestamp()
    });

    showToast("Request submitted successfully.", "success");
    closeNewRequestModal();
    await loadMyRequests();
  } catch (err) {
    showToast(err.message || "Failed to submit request.", "error");
  } finally {
    hideLoading(btn);
  }
}

/* ------------------------------------------------------------------ */
/* Load my requests history                                            */
/* ------------------------------------------------------------------ */
async function loadMyRequests() {
  const body = document.getElementById("myRequestsBody");
  if (!body) return;

  // Use onSnapshot for real-time updates
  if (window._myRequestsUnsub) { window._myRequestsUnsub(); window._myRequestsUnsub = null; }

  window._myRequestsUnsub = db.collection("requests")
    .where("employeeId", "==", _user.uid)
    .limit(50)
    .onSnapshot((snap) => {
      const records = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => b.createdAt?.toDate() - a.createdAt?.toDate());

      if (!records.length) {
        body.innerHTML = `<tr><td colspan="5" class="text-center text-light">
          No requests yet. Click "+ New Request" to submit one.</td></tr>`;
        return;
      }

      body.innerHTML = records.map((r) => {
        const statusBadge = _empReqStatusBadge(r.status);
        const details = r.fieldValues
          ? Object.entries(r.fieldValues)
              .map(([k, v]) => `<div><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}</div>`)
              .join("")
          : "—";
        return `<tr>
          <td class="text-sm">${formatDate(r.createdAt)}</td>
          <td><span class="badge badge--info">${escapeHtml(r.requestTypeName)}</span></td>
          <td class="text-sm">${details}</td>
          <td>${statusBadge}</td>
          <td class="text-sm">${escapeHtml(r.adminRemarks || "—")}</td>
        </tr>`;
      }).join("");
    }, (err) => {
      console.error("loadMyRequests:", err);
      body.innerHTML = `<tr><td colspan="5" class="text-center text-light">Error loading requests.</td></tr>`;
    });
}

function _empReqStatusBadge(status) {
  const map = {
    pending:  '<span class="badge badge--warning">Pending</span>',
    approved: '<span class="badge badge--success">Approved</span>',
    denied:   '<span class="badge badge--danger">Denied</span>'
  };
  return map[status] || '<span class="badge badge--gray">Unknown</span>';
}

/* ------------------------------------------------------------------ */
/* Modal helpers                                                       */
/* ------------------------------------------------------------------ */
function openNewRequestModal() {
  document.getElementById("newRequestForm").reset();
  document.getElementById("reqDynamicFields").innerHTML = "";
  document.getElementById("newRequestOverlay").classList.add("modal-overlay--show");
}

function closeNewRequestModal() {
  document.getElementById("newRequestOverlay").classList.remove("modal-overlay--show");
}

/* ------------------------------------------------------------------ */
/* Hook into employee.js init — wait for _user to be ready            */
/* ------------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  // employee.js sets _user inside auth.onAuthStateChanged, which is async.
  // We poll until _user is populated then init.
  const waitForUser = setInterval(() => {
    if (typeof _user !== "undefined" && _user !== null) {
      clearInterval(waitForUser);
      initEmployeeRequests();
    }
  }, 300);

  // Stop polling after 15 seconds to avoid infinite loop if auth fails
  setTimeout(() => clearInterval(waitForUser), 15000);
});
