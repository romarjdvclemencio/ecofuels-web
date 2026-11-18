/**
 * Dashboard Calendar
 * - Renders a monthly calendar with Philippine holidays
 * - Admin can click any day to set it as: Normal / Closed / Half Day
 * - Day settings stored in Firestore: workDays/{YYYY-MM-DD}
 * - Employees check this collection before allowing attendance
 */

/* ------------------------------------------------------------------ */
/*  Philippine Public Holidays (regular + special non-working)        */
/*  Format: "MM-DD" for fixed dates, functions for moveable ones      */
/* ------------------------------------------------------------------ */
function _getPHHolidays(year) {
  const h = {};

  const add = (mmdd, name, type = "regular") => {
    h[`${year}-${mmdd}`] = { name, type };
  };

  // Regular holidays (fixed)
  add("01-01", "New Year's Day");
  add("04-09", "Araw ng Kagitingan (Day of Valor)");
  add("05-01", "Labor Day");
  add("06-12", "Independence Day");
  add("08-26", "National Heroes Day");  // last Monday Aug — approximated
  add("11-30", "Bonifacio Day");
  add("12-25", "Christmas Day");
  add("12-30", "Rizal Day");

  // Special non-working holidays (fixed)
  add("02-25", "EDSA People Power Revolution Anniversary", "special");
  add("08-21", "Ninoy Aquino Day", "special");
  add("11-01", "All Saints' Day", "special");
  add("11-02", "All Souls' Day", "special");
  add("12-08", "Feast of the Immaculate Conception", "special");
  add("12-24", "Christmas Eve", "special");
  add("12-31", "Last Day of the Year", "special");

  // Moveable: Maundy Thursday, Good Friday, Black Saturday (Easter-based)
  const easter = _easterDate(year);
  const maundyThursday = new Date(easter); maundyThursday.setDate(easter.getDate() - 3);
  const goodFriday     = new Date(easter); goodFriday.setDate(easter.getDate() - 2);
  const blackSaturday  = new Date(easter); blackSaturday.setDate(easter.getDate() - 1);
  add(_fmt(maundyThursday), "Maundy Thursday");
  add(_fmt(goodFriday),     "Good Friday");
  add(_fmt(blackSaturday),  "Black Saturday", "special");

  // Eid'l Fitr & Eid'l Adha — approximate for current year
  // These vary; we include approximate dates commonly declared
  const eidFitr = _eidFitr(year);
  const eidAdha = _eidAdha(year);
  if (eidFitr) add(_fmt(eidFitr), "Eid'l Fitr");
  if (eidAdha) add(_fmt(eidAdha), "Eid'l Adha");

  return h;
}

/* Easter calculation (Anonymous Gregorian) */
function _easterDate(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/* Approximate Eid dates (based on recent PH proclamations) */
function _eidFitr(year) {
  const approx = { 2024: "04-10", 2025: "03-31", 2026: "03-20", 2027: "03-10" };
  if (approx[year]) {
    const [m, d] = approx[year].split("-").map(Number);
    return new Date(year, m - 1, d);
  }
  return null;
}
function _eidAdha(year) {
  const approx = { 2024: "06-17", 2025: "06-07", 2026: "05-27", 2027: "05-17" };
  if (approx[year]) {
    const [m, d] = approx[year].split("-").map(Number);
    return new Date(year, m - 1, d);
  }
  return null;
}

function _fmt(date) {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/* ------------------------------------------------------------------ */
/*  State                                                               */
/* ------------------------------------------------------------------ */
let _calYear      = new Date().getFullYear();
let _calMonth     = new Date().getMonth(); // 0-indexed
let _calDayData   = {};   // Firestore custom day settings keyed by YYYY-MM-DD
let _calHolidays  = {};
let _calUnsub     = null;
let _dayModalDate = null; // currently editing date key

/* ------------------------------------------------------------------ */
/*  Init — call once admin page loads                                  */
/* ------------------------------------------------------------------ */
function initCalendar() {
  _calHolidays = { ..._getPHHolidays(_calYear - 1), ..._getPHHolidays(_calYear), ..._getPHHolidays(_calYear + 1) };
  _startCalListener();
  _renderCalendar();
  _overlayClick("dayModalOverlay", closeDayModal);
}

/* ------------------------------------------------------------------ */
/*  Firestore listener for custom day settings                         */
/* ------------------------------------------------------------------ */
function _startCalListener() {
  if (_calUnsub) { _calUnsub(); _calUnsub = null; }

  // Listen to the whole workDays collection
  _calUnsub = db.collection("workDays").onSnapshot((snap) => {
    _calDayData = {};
    snap.docs.forEach((d) => { _calDayData[d.id] = d.data(); });
    _renderCalendar();
  }, (err) => console.error("calendar listener:", err));
}

/* ------------------------------------------------------------------ */
/*  Render                                                              */
/* ------------------------------------------------------------------ */
function _renderCalendar() {
  const title = document.getElementById("calTitle");
  const grid  = document.getElementById("calGrid");
  if (!title || !grid) return;

  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  title.textContent = `${monthNames[_calMonth]} ${_calYear}`;

  const firstDay = new Date(_calYear, _calMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(_calYear, _calMonth + 1, 0).getDate();
  const today = new Date();
  const todayKey = _fmt(today);

  let html = "";

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    html += `<div class="cal-day cal-day--empty"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date    = new Date(_calYear, _calMonth, d);
    const dateKey = _fmt(date);
    const dow     = date.getDay(); // 0=Sun,6=Sat
    const isPast  = date < new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const holiday  = _calHolidays[dateKey];
    const custom   = _calDayData[dateKey];
    const isClosed = custom?.status === "closed" || (dow === 0); // Sunday always closed
    const isHalf   = custom?.status === "halfday";
    const isToday  = dateKey === todayKey;

    let classes = "cal-day";
    if (isToday)        classes += " cal-day--today";
    if (isClosed)       classes += " cal-day--closed";
    else if (isHalf)    classes += " cal-day--halfday";
    else if (holiday)   classes += " cal-day--holiday";
    if (dow === 0)      classes += " cal-day--sunday";
    if (dow === 6)      classes += " cal-day--saturday";
    if (isPast)         classes += " cal-day--past";

    // Dot indicators
    let dot = "";
    if (isClosed && !holiday)    dot = `<div class="cal-dot cal-dot--closed"></div>`;
    else if (isHalf)             dot = `<div class="cal-dot cal-dot--halfday"></div>`;
    else if (holiday)            dot = `<div class="cal-dot cal-dot--holiday"></div>`;

    const title = holiday ? holiday.name : (custom?.note || "");

    html += `<div class="${classes}" onclick="openDayModal('${dateKey}')" title="${escapeHtml(title)}">
      <span class="cal-day__num">${d}</span>
      ${dot}
    </div>`;
  }

  grid.innerHTML = html;
}

function calPrevMonth() {
  _calMonth--;
  if (_calMonth < 0) { _calMonth = 11; _calYear--; }
  // Refresh holidays for new year if needed
  if (!_calHolidays[`${_calYear}-01-01`]) {
    Object.assign(_calHolidays, _getPHHolidays(_calYear));
  }
  _renderCalendar();
}

function calNextMonth() {
  _calMonth++;
  if (_calMonth > 11) { _calMonth = 0; _calYear++; }
  if (!_calHolidays[`${_calYear}-01-01`]) {
    Object.assign(_calHolidays, _getPHHolidays(_calYear));
  }
  _renderCalendar();
}

/* ------------------------------------------------------------------ */
/*  Day modal                                                           */
/* ------------------------------------------------------------------ */
function openDayModal(dateKey) {
  _dayModalDate = dateKey;

  const [y, m, d] = dateKey.split("-");
  const label = new Date(+y, +m - 1, +d).toLocaleDateString("en-PH", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

  document.getElementById("dayModalTitle").textContent = label;

  // Show holiday info if applicable
  const holiday    = _calHolidays[dateKey];
  const infoEl     = document.getElementById("dayModalHolidayInfo");
  if (holiday) {
    infoEl.textContent = `${holiday.type === "special" ? "Special Non-Working" : "Regular"} Holiday: ${holiday.name}`;
    infoEl.classList.remove("hidden");
  } else {
    infoEl.classList.add("hidden");
  }

  // Load existing settings
  const existing = _calDayData[dateKey];
  document.getElementById("dayStatus").value        = existing?.status     || "normal";
  document.getElementById("halfDayPeriod").value    = existing?.period     || "am";
  document.getElementById("halfDayCutoff").value    = existing?.cutoff     || "12:00";
  document.getElementById("dayNote").value          = existing?.note       || (holiday?.name || "");

  toggleHalfDayOptions();
  _showOverlay("dayModalOverlay");
}

function closeDayModal() { _hideOverlay("dayModalOverlay"); }

function toggleHalfDayOptions() {
  const isHalf = document.getElementById("dayStatus").value === "halfday";
  document.getElementById("halfDayOptions").classList.toggle("hidden", !isHalf);
}

async function saveDaySettings() {
  if (!_dayModalDate) return;

  const status = document.getElementById("dayStatus").value;
  const note   = document.getElementById("dayNote").value.trim();
  const period = document.getElementById("halfDayPeriod").value;
  const cutoff = document.getElementById("halfDayCutoff").value;

  const data = { status, note, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
  if (status === "halfday") { data.period = period; data.cutoff = cutoff; }

  try {
    if (status === "normal" && !note) {
      // Remove doc if resetting to normal with no note
      await db.collection("workDays").doc(_dayModalDate).delete();
    } else {
      await db.collection("workDays").doc(_dayModalDate).set(data);
    }
    showToast("Day settings saved.", "success");
    closeDayModal();
  } catch (err) {
    showToast("Failed to save: " + err.message, "error");
  }
}

async function clearDaySettings() {
  if (!_dayModalDate) return;
  try {
    await db.collection("workDays").doc(_dayModalDate).delete();
    showToast("Day restriction removed.", "success");
    closeDayModal();
  } catch (err) {
    showToast("Failed to remove restriction.", "error");
  }
}
