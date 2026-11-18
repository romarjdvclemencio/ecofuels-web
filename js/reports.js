/**
 * Report export utilities (Excel + PDF).
 * Reads from window._attendanceData set by admin.js.
 */

/* ------------------------------------------------------------------ */
/* Excel export                                                        */
/* ------------------------------------------------------------------ */

function exportAttendanceExcel() {
  const data = window._attendanceData || [];
  if (!data.length) {
    showToast("No attendance records to export.", "warning");
    return;
  }

  const rows = data.map((r) => ({
    Employee:      r.employeeName   || "—",
    Department:    r.departmentName || "—",
    Type:          r.type === "check_in" ? "Check In" : "Check Out",
    Date:          formatDate(r.timestamp),
    Time:          formatTime(r.timestamp),
    Location:      r.locationName || (r.location ? `${r.location.latitude.toFixed(5)}, ${r.location.longitude.toFixed(5)}` : "—"),
    "Maps Link":   r.location ? `https://maps.google.com/?q=${r.location.latitude},${r.location.longitude}` : "—"
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 24 }, { wch: 20 }, { wch: 12 }, { wch: 14 },
    { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 40 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Attendance");
  XLSX.writeFile(wb, `attendance_${toDateInput(new Date())}.xlsx`);
  showToast("Excel file downloaded.", "success");
}

/* ------------------------------------------------------------------ */
/* PDF export                                                          */
/* ------------------------------------------------------------------ */

function exportAttendancePDF() {
  const data = window._attendanceData || [];
  if (!data.length) {
    showToast("No attendance records to export.", "warning");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  doc.setFontSize(16);
  doc.text("Attendance Report", 40, 40);
  doc.setFontSize(10);
  doc.text(`Generated: ${formatDateTime(new Date())}`, 40, 56);

  const checkIns  = data.filter((r) => r.type === "check_in").length;
  const checkOuts = data.filter((r) => r.type === "check_out").length;
  doc.text(`Total: ${data.length}  |  Check-ins: ${checkIns}  |  Check-outs: ${checkOuts}`, 40, 70);

  const head = [["Employee", "Department", "Type", "Date", "Time", "Location", "Maps Link"]];
  const body = data.map((r) => [
    r.employeeName   || "—",
    r.departmentName || "—",
    r.type === "check_in" ? "Check In" : "Check Out",
    formatDate(r.timestamp),
    formatTime(r.timestamp),
    r.locationName || (r.location ? `${r.location.latitude.toFixed(5)}, ${r.location.longitude.toFixed(5)}` : "—"),
    r.location ? `https://maps.google.com/?q=${r.location.latitude},${r.location.longitude}` : "—"
  ]);

  doc.autoTable({
    head,
    body,
    startY: 84,
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [22, 163, 74], textColor: 255 },
    alternateRowStyles: { fillColor: [240, 253, 244] },
    columnStyles: { 0: { cellWidth: 130 } }
  });

  doc.save(`attendance_${toDateInput(new Date())}.pdf`);
  showToast("PDF file downloaded.", "success");
}
