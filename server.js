const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'attendance_db.json');

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const TOTAL_STUDENTS = 64;

function loadDatabase() {
  if (fs.existsSync(DB_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    } catch (e) {
      console.error("Database read error, reinitializing...", e);
    }
  }

  const defaultRoster = [];
  defaultRoster.push({
    roll: "FYIT-01",
    name: "Reuben Larasimonraj Kaundar",
    present: false,
    time: "-",
    isLate: false,
    lecturesAttended: 0,
    totalLectures: 0,
    attendancePercentage: 0,
    history: []
  });

  for (let i = 2; i <= TOTAL_STUDENTS; i++) {
    const rollStr = i < 10 ? `FYIT-0${i}` : `FYIT-${i}`;
    defaultRoster.push({
      roll: rollStr,
      name: `Student ${i}`,
      present: false,
      time: "-",
      isLate: false,
      lecturesAttended: 0,
      totalLectures: 0,
      attendancePercentage: 0,
      history: []
    });
  }

  const initialData = {
    totalLecturesConducted: 0,
    roster: defaultRoster,
    savedSessions: []
  };

  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
  } catch (e) {}
  return initialData;
}

function saveDatabase(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (e) {}
}

let db = loadDatabase();
let lastTapTimestamp = 0;
let lastTappedRoll = "";

// 1. GET Current Roster & Summary
app.get('/api/roster', (req, res) => {
  const presentCount = db.roster.filter(s => s.present).length;
  res.json({
    success: true,
    total: TOTAL_STUDENTS,
    present: presentCount,
    absent: TOTAL_STUDENTS - presentCount,
    turnout: ((presentCount / TOTAL_STUDENTS) * 100).toFixed(1),
    totalLecturesConducted: db.totalLecturesConducted || 0,
    roster: db.roster
  });
});

// 2. POST NFC Tap (With Anti-Proxy Debounce & Late Detection)
app.post('/api/attendance', (req, res) => {
  const { roll, isLate } = req.body;
  const now = Date.now();

  if (!roll) return res.status(400).json({ success: false, message: "Roll number required." });

  // Anti-Proxy Check: Prevent multiple distinct cards swiping under 3 seconds
  if (now - lastTapTimestamp < 3000 && lastTappedRoll !== roll) {
    return res.status(429).json({
      success: false,
      message: "ANTI-PROXY ALERT: Rapid successive scans detected. 3-second delay required between different student cards."
    });
  }

  const student = db.roster.find(s => s.roll.toUpperCase() === roll.toUpperCase());
  if (!student) return res.status(404).json({ success: false, message: `Student ${roll} not recognized.` });

  if (student.present) {
    return res.status(409).json({
      success: false,
      message: `Duplicate Tap: ${student.roll} (${student.name}) is already marked PRESENT.`
    });
  }

  const scanTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  student.present = true;
  student.time = scanTime;
  student.isLate = Boolean(isLate);

  lastTapTimestamp = now;
  lastTappedRoll = roll;
  saveDatabase(db);

  const presentCount = db.roster.filter(s => s.present).length;
  res.status(201).json({
    success: true,
    message: `Verified: ${student.roll} - ${student.name}${student.isLate ? " (LATE ENTRY)" : ""}`,
    student,
    stats: {
      total: TOTAL_STUDENTS,
      present: presentCount,
      absent: TOTAL_STUDENTS - presentCount,
      turnout: ((presentCount / TOTAL_STUDENTS) * 100).toFixed(1)
    }
  });
});

// 3. POST Commit & Save Lecture Session
app.post('/api/save-session', (req, res) => {
  const { subject, date, slot } = req.body;

  db.totalLecturesConducted = (db.totalLecturesConducted || 0) + 1;

  const sessionSummary = {
    sessionId: `SESS_${Date.now()}`,
    subject,
    date,
    slot,
    savedAt: new Date().toISOString(),
    attendanceRecords: []
  };

  db.roster.forEach(student => {
    student.totalLectures = db.totalLecturesConducted;

    if (student.present) {
      student.lecturesAttended = (student.lecturesAttended || 0) + 1;
    }

    student.attendancePercentage = Number(((student.lecturesAttended / student.totalLectures) * 100).toFixed(1));

    const record = {
      subject,
      date,
      slot,
      status: student.present ? (student.isLate ? "LATE" : "PRESENT") : "ABSENT",
      timeIn: student.time
    };

    student.history.unshift(record);
    sessionSummary.attendanceRecords.push({ roll: student.roll, ...record });

    student.present = false;
    student.time = "-";
    student.isLate = false;
  });

  db.savedSessions.unshift(sessionSummary);
  saveDatabase(db);

  res.json({
    success: true,
    message: `Lecture session committed to official ledger. Total lectures conducted: ${db.totalLecturesConducted}`,
    totalLecturesConducted: db.totalLecturesConducted,
    roster: db.roster
  });
});

// 4. POST Reset Database
app.post('/api/reset', (req, res) => {
  if (fs.existsSync(DB_FILE)) {
    try { fs.unlinkSync(DB_FILE); } catch (e) {}
  }
  db = loadDatabase();
  res.json({ success: true, message: "Attendance database wiped and reset to zero." });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`SXC Terminal Server live on port ${PORT}`));

module.exports = app;
