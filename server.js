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
    isLate: false,
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
      history: []
    });
  }

  const initialData = { roster: defaultRoster, logs: [] };
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

app.get('/api/roster', (req, res) => {
  const presentCount = db.roster.filter(s => s.present).length;
  res.json({
    success: true,
    total: TOTAL_STUDENTS,
    present: presentCount,
    absent: TOTAL_STUDENTS - presentCount,
    turnout: ((presentCount / TOTAL_STUDENTS) * 100).toFixed(1),
    roster: db.roster
  });
});

app.post('/api/attendance', (req, res) => {
  const { roll, subject, slot, date, scanTime, isLate } = req.body;

  if (!roll || !subject) {
    return res.status(400).json({ success: false, message: "Roll number and Subject required." });
  }

  const student = db.roster.find(s => s.roll.toUpperCase() === roll.toUpperCase());

  if (!student) {
    return res.status(404).json({ success: false, message: `Student ${roll} not found.` });
  }

  if (student.present) {
    return res.status(409).json({
      success: false,
      message: `Already marked PRESENT: ${student.roll} (${student.name})`
    });
  }

  student.present = true;
  student.time = scanTime;
  student.isLate = Boolean(isLate);

  const entry = {
    id: `ATT-${Date.now()}`,
    roll: student.roll,
    name: student.name,
    subject,
    slot,
    date,
    scanTime,
    status: student.isLate ? "LATE" : "PRESENT",
    recordedAt: new Date().toISOString()
  };

  student.history.unshift(entry);
  db.logs.unshift(entry);
  saveDatabase(db);

  const presentCount = db.roster.filter(s => s.present).length;

  res.status(201).json({
    success: true,
    message: `Attendance recorded on backend storage for ${student.roll}`,
    student,
    stats: {
      total: TOTAL_STUDENTS,
      present: presentCount,
      absent: TOTAL_STUDENTS - presentCount,
      turnout: ((presentCount / TOTAL_STUDENTS) * 100).toFixed(1)
    }
  });
});

app.post('/api/reset', (req, res) => {
  db = { roster: [], logs: [] };
  if (fs.existsSync(DB_FILE)) {
    try { fs.unlinkSync(DB_FILE); } catch (e) {}
  }
  db = loadDatabase();
  res.json({ success: true, message: "Database wiped and re-seeded." });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server live on port ${PORT}`);
});

module.exports = app;
