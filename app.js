let roster = [];
let activeFilter = 'all';

document.getElementById("lectureDate").valueAsDate = new Date();
setFilter('all');
fetchRoster();

async function fetchRoster() {
  try {
    const res = await fetch('/api/roster');
    const data = await res.json();
    if (data.success) {
      roster = data.roster;
      document.getElementById("conductedCount").innerText = `Lectures: ${data.totalLecturesConducted}`;
      updateMetrics(data.present, data.absent, data.turnout);
      populateWriterDropdown();
      renderRoster();
    }
  } catch (e) {
    document.getElementById("serverState").innerText = "Offline Mode";
  }
}

function setFilter(type) {
  activeFilter = type;
  document.getElementById("filterAll").className = `pill ${type === 'all' ? 'active' : ''}`;
  document.getElementById("filterDefaulters").className = `pill ${type === 'defaulters' ? 'active' : ''}`;
  renderRoster();
}

function playSuccessChime(isLate) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(isLate ? 520 : 880, ctx.currentTime);
    if (!isLate) osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.22);
  } catch (e) {}
}

function speak(text) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;
    window.speechSynthesis.speak(utter);
  }
}

function checkIsLate() {
  const startTimeVal = document.getElementById("lectureStartTime").value;
  if (!startTimeVal) return false;
  const [startH, startM] = startTimeVal.split(":").map(Number);
  const now = new Date();
  const lectureStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startH, startM, 0);
  const diffMinutes = (now - lectureStart) / 1000 / 60;
  return diffMinutes > 15;
}

async function recordStudentAttendance(roll) {
  const isLate = checkIsLate();
  try {
    const res = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roll, isLate })
    });
    const data = await res.json();

    if (!res.ok) {
      setStatus(data.message, "var(--danger-bg)", "var(--danger)");
      navigator.vibrate?.([60, 60, 60]);
      return;
    }

    const match = roster.find(s => s.roll === roll);
    if (match) {
      match.present = true;
      match.time = data.student.time;
      match.isLate = data.student.isLate;
    }

    updateMetrics(data.stats.present, data.stats.absent, data.stats.turnout);
    renderRoster();
    playSuccessChime(isLate);
    speak(`${data.student.name}, ${isLate ? 'Marked Late' : 'Present'}`);
    setStatus(`Verified: ${data.student.roll} — ${data.student.name} ${isLate ? '(LATE)' : ''}`, "var(--success-bg)", "var(--success)");

  } catch (err) {
    setStatus(`Network issue: ${err.message}`, "var(--danger-bg)", "var(--danger)");
  }
}

async function startNfcScanner() {
  if (!("NDEFReader" in window)) {
    setStatus("Web NFC requires Google Chrome on Android over HTTPS. (Use '⚡ Demo Tap' to test on Desktop/iOS)", "var(--danger-bg)", "var(--danger)");
    return;
  }

  try {
    const ndef = new NDEFReader();
    await ndef.scan();
    setStatus("Ready! Hold student ID card to the back of the phone...", "var(--warning-bg)", "var(--warning)");

    ndef.onreading = async (event) => {
      let scannedTag = "";
      const decoder = new TextDecoder();
      if (event.message?.records) {
        for (const r of event.message.records) {
          if (r.data) scannedTag += decoder.decode(r.data) + " ";
        }
      }
      if (!scannedTag.trim() && event.serialNumber) scannedTag = event.serialNumber;
      scannedTag = scannedTag.trim().toUpperCase();

      let match = roster.find(s => scannedTag.includes(s.roll) || s.roll === scannedTag) || roster[0];
      await recordStudentAttendance(match.roll);
    };
  } catch (err) {
    setStatus(`Scanner initialization failed: ${err.message}`, "var(--danger-bg)", "var(--danger)");
  }
}

function simulateDemoTap() {
  recordStudentAttendance("FYIT-01");
}

async function executeNfcWrite() {
  if (!("NDEFReader" in window)) {
    alert("Web NFC writer requires Chrome on Android.");
    return;
  }
  const targetRoll = document.getElementById("writerRollSelect").value;
  try {
    const ndef = new NDEFReader();
    setStatus(`Hold blank NFC card to phone to write: ${targetRoll}...`, "var(--warning-bg)", "var(--warning)");
    closeWriterModal();
    await ndef.write({ records: [{ recordType: "text", data: targetRoll }] });
    setStatus(`Successfully encoded card with ${targetRoll}!`, "var(--success-bg)", "var(--success)");
    speak("Tag Programmed Successfully");
  } catch (err) {
    setStatus(`Tag write failed: ${err.message}`, "var(--danger-bg)", "var(--danger)");
  }
}

function openWriterModal() { document.getElementById("writerModal").style.display = "flex"; }
function closeWriterModal() { document.getElementById("writerModal").style.display = "none"; }

function populateWriterDropdown() {
  const select = document.getElementById("writerRollSelect");
  select.innerHTML = "";
  roster.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.roll;
    opt.textContent = `${s.roll} - ${s.name}`;
    select.appendChild(opt);
  });
}

async function saveSessionToLedger() {
  const subject = document.getElementById("subjectSelect").value;
  const date = document.getElementById("lectureDate").value;
  const slot = document.getElementById("lectureStartTime").value;
  const presentCount = roster.filter(s => s.present).length;

  if (!confirm(`Commit attendance for ${subject}?\n\nPresent: ${presentCount} / 64 students.`)) return;

  try {
    const res = await fetch('/api/save-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, date, slot })
    });
    const data = await res.json();
    if (data.success) {
      roster = data.roster;
      document.getElementById("conductedCount").innerText = `Lectures: ${data.totalLecturesConducted}`;
      updateMetrics(0, 64, "0.0");
      renderRoster();
      setStatus("Session finalized & ledger updated!", "var(--success-bg)", "var(--success)");
    }
  } catch (err) {
    setStatus(`Save error: ${err.message}`, "var(--danger-bg)", "var(--danger)");
  }
}

function renderRoster() {
  const tbody = document.getElementById("rosterTableBody");
  tbody.innerHTML = "";
  const query = (document.getElementById("rosterSearch")?.value || "").toLowerCase();

  roster.forEach(s => {
    const pct = s.attendancePercentage || 0;
    if (activeFilter === 'defaulters' && (pct >= 75 || s.totalLectures === 0)) return;
    if (query && !s.roll.toLowerCase().includes(query) && !s.name.toLowerCase().includes(query)) return;

    const tr = document.createElement("tr");
    const pctColor = pct < 75 ? "var(--danger)" : "var(--success)";
    let statusTag = `<span class="tag tag-absent">ABSENT</span>`;
    if (s.present) {
      statusTag = s.isLate 
        ? `<span class="tag tag-late">LATE (${s.time})</span>` 
        : `<span class="tag tag-present">PRESENT (${s.time})</span>`;
    }

    tr.innerHTML = `
      <td><strong>${s.roll}</strong></td>
      <td class="text-left" style="color: #cbd5e1;">${s.name}</td>
      <td>${statusTag}</td>
      <td style="color: var(--text-muted);">${s.lecturesAttended || 0} / ${s.totalLectures || 0}</td>
      <td style="color: ${pctColor}; font-weight: 700;">${pct}%</td>
    `;
    tbody.appendChild(tr);
  });
}

function updateMetrics(pres, abs, pct) {
  document.getElementById("statPresent").innerText = pres;
  document.getElementById("statAbsent").innerText = abs;
  document.getElementById("statPercent").innerText = `${pct}%`;
}

async function resetAll() {
  if (!confirm("Clear all session history and reset entire attendance ledger to zero?")) return;
  const res = await fetch('/api/reset', { method: 'POST' });
  const data = await res.json();
  if (data.success) {
    fetchRoster();
    setStatus("Ledger completely wiped and reset.", "var(--surface-elevated)", "var(--text)");
  }
}

function exportAttendanceCSV() {
  const sub = document.getElementById("subjectSelect").value;
  const date = document.getElementById("lectureDate").value;
  let csv = `St. Xavier's College - Official Attendance Ledger\nDate: ${date}\nSubject: ${sub}\n\n`;
  csv += "Roll No,Student Name,Attended,Total Lectures,Percentage,Defaulter (<75%)\n";

  roster.forEach(s => {
    const pct = s.attendancePercentage || 0;
    const isDefaulter = pct < 75 ? "YES" : "NO";
    csv += `"${s.roll}","${s.name}",${s.lecturesAttended || 0},${s.totalLectures || 0},${pct}%,${isDefaulter}\n`;
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", `SXC_Ledger_${date}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function setStatus(msg, bg, color) {
  const box = document.getElementById("statusMsg");
  box.innerHTML = msg;
  box.style.background = bg;
  box.style.color = color;
  box.style.borderColor = color;
}
