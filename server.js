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
      console.error("Error reading database", e);
    }
  }

  const defaultRoster = [];
  defaultRoster.push({
    roll: "FYIT-01",
    name: "Reuben Larasimonraj Kaundar",
    present: false,
    time: "-",
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

// 2. POST NFC Tap (Live Check-in)
app.post('/api/attendance', (req, res) => {
  const { roll } = req.body;
  if (!roll) return res.status(400).json({ success: false, message: "Roll number required." });

  const student = db.roster.find(s => s.roll.toUpperCase() === roll.toUpperCase());
  if (!student) return res.status(404).json({ success: false, message: `Student ${roll} not found.` });

  if (student.present) {
    return res.status(409).json({ success: false, message: `${student.roll} is already marked PRESENT.` });
  }

  const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  student.present = true;
  student.time = nowTime;
  saveDatabase(db);

  const presentCount = db.roster.filter(s => s.present).length;
  res.status(201).json({
    success: true,
    message: `Verified: ${student.roll} - ${student.name}`,
    student,
    stats: {
      total: TOTAL_STUDENTS,
      present: presentCount,
      absent: TOTAL_STUDENTS - presentCount,
      turnout: ((presentCount / TOTAL_STUDENTS) * 100).toFixed(1)
    }
  });
});

// 3. POST Commit & Save Lecture Session (Permanent Ledger Update)
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
      status: student.present ? "PRESENT" : "ABSENT",
      timeIn: student.time
    };

    student.history.unshift(record);
    sessionSummary.attendanceRecords.push({ roll: student.roll, ...record });

    // Reset temporary session flag for next lecture
    student.present = false;
    student.time = "-";
  });

  db.savedSessions.unshift(sessionSummary);
  saveDatabase(db);

  res.json({
    success: true,
    message: `Lecture session successfully archived to student profiles! Total lectures: ${db.totalLecturesConducted}`,
    totalLecturesConducted: db.totalLecturesConducted,
    roster: db.roster
  });
});

// 4. POST Reset Entire Database
app.post('/api/reset', (req, res) => {
  if (fs.existsSync(DB_FILE)) {
    try { fs.unlinkSync(DB_FILE); } catch (e) {}
  }
  db = loadDatabase();
  res.json({ success: true, message: "All attendance history and ledger data reset." });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`Attendance Engine live on ${PORT}`));

module.exports = app;
