const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const port = 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.redirect("/login.html");
});

app.use(express.static(path.join(__dirname, "public")));

//
// DATA FOLDERS
//
const dataDir = path.join(__dirname, "data");
const usersFile = path.join(dataDir, "users.json");
const messagesFile = path.join(dataDir, "messages.json");
const labsFile = path.join(dataDir, "labs.json");
const appointmentsFile = path.join(dataDir, "appointments.json");
const profilesFile = path.join(dataDir, "profiles.json");

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

  // USERS
  if (!fs.existsSync(usersFile)) {
    const defaultUsers = [
      { username: "doctor", password: "doctor123", role: "doctor", name: "Dr. Taheri" },
      { username: "patient1", password: "patient123", role: "patient", name: "Idris" },
      { username: "patient2", password: "patient123", role: "patient", name: "Bilal" }
    ];
    fs.writeFileSync(usersFile, JSON.stringify(defaultUsers, null, 2));
  }

  // MESSAGES
  if (!fs.existsSync(messagesFile)) {
    fs.writeFileSync(messagesFile, JSON.stringify([], null, 2));
  }

  // LAB RESULTS
  if (!fs.existsSync(labsFile)) {
    fs.writeFileSync(labsFile, JSON.stringify([], null, 2));
  }

  if (!fs.existsSync(appointmentsFile)) {
    fs.writeFileSync(appointmentsFile, JSON.stringify([], null, 2));
  }

  if (!fs.existsSync(profilesFile)) {
    fs.writeFileSync(profilesFile, JSON.stringify([], null, 2));
  }
}

ensureDataDir();

function load(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const sessions = {};

function createToken(username) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions[token] = { username };
  return token;
}

function getUserByUsername(username) {
  const users = load(usersFile);
  return users.find(u => u.username === username);
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const parts = header.split(" ");
  if (parts.length === 2 && parts[0] === "Bearer") {
    const token = parts[1];
    const session = sessions[token];
    if (session) {
      const user = getUserByUsername(session.username);
      if (user) {
        req.user = { username: user.username, role: user.role, name: user.name };
        req.token = token;
        return next();
      }
    }
  }
  return res.status(401).json({ error: "UNAUTHORIZED" });
}

//
// LOGIN
//
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const users = load(usersFile);
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) {
    return res.status(401).json({ error: "WRONG_LOGIN" });
  }
  const token = createToken(user.username);
  res.json({
    token,
    user: {
      username: user.username,
      role: user.role,
      name: user.name
    }
  });
});

app.post("/api/logout", auth, (req, res) => {
  if (req.token && sessions[req.token]) {
    delete sessions[req.token];
  }
  res.json({ ok: true });
});

app.get("/api/me", auth, (req, res) => {
  const user = getUserByUsername(req.user.username);
  const email = req.user.username + "@example.com";
  res.json({
    username: req.user.username,
    role: req.user.role,
    name: user ? user.name : "",
    email
  });
});

app.get("/api/profile", auth, (req, res) => {
  const profiles = load(profilesFile);
  const profile = profiles.find(p => p.username === req.user.username);
  const user = getUserByUsername(req.user.username);
  const email = req.user.username + "@example.com";
  if (profile) {
    return res.json({
      name: profile.name || (user ? user.name : ""),
      city: profile.city || "",
      email: profile.email || email
    });
  }
  res.json({
    name: user ? user.name : "",
    city: "",
    email
  });
});

app.put("/api/profile", auth, (req, res) => {
  const { name, city, email } = req.body || {};
  let profiles = load(profilesFile);
  const idx = profiles.findIndex(p => p.username === req.user.username);
  if (idx >= 0) {
    profiles[idx] = {
      ...profiles[idx],
      name,
      city,
      email
    };
  } else {
    profiles.push({
      username: req.user.username,
      name,
      city,
      email
    });
  }
  save(profilesFile, profiles);
  const users = load(usersFile);
  const uIdx = users.findIndex(u => u.username === req.user.username);
  if (uIdx >= 0 && name) {
    users[uIdx].name = name;
    save(usersFile, users);
  }
  res.json({ name, city, email });
});

app.get("/api/patients", auth, (req, res) => {
  const users = load(usersFile);
  const patients = users
    .filter(u => u.role === "patient")
    .map(u => ({
      id: u.username,
      name: u.name,
      email: u.username + "@example.com"
    }));
  res.json(patients);
});

//
// MESSAGES (doctor <-> patient)
//
app.get("/api/messages", auth, (req, res) => {
  const all = load(messagesFile);
  const list = all.filter(m => m.toUserId === req.user.username);
  res.json(list);
});

app.get("/api/messages/outbox", auth, (req, res) => {
  const all = load(messagesFile);
  const list = all.filter(m => m.fromUserId === req.user.username);
  res.json(list);
});

app.post("/api/messages", auth, (req, res) => {
  const { toUserId, subject, body } = req.body;
  if (!toUserId || !subject || !body) {
    return res.status(400).json({ error: "MISSING_FIELDS" });
  }
  const all = load(messagesFile);
  const newMsg = {
    id: Date.now(),
    fromUserId: req.user.username,
    toUserId,
    subject,
    body,
    date: new Date().toISOString()
  };
  all.push(newMsg);
  save(messagesFile, all);
  res.json(newMsg);
});

//
// LAB RESULTS
//
app.get("/api/labs", auth, (req, res) => {
  const all = load(labsFile);
  const list = all.filter(l => l.patientId === req.user.username);
  res.json(list);
});

app.post("/api/labs", auth, (req, res) => {
  const { patientId, date, title, status, result } = req.body;
  if (!patientId || !title) {
    return res.status(400).json({ error: "MISSING_FIELDS" });
  }
  const all = load(labsFile);
  const newLab = {
    id: Date.now(),
    patientId,
    title,
    status: status || "",
    result: result || "",
    date: date || new Date().toISOString().split("T")[0]
  };
  all.push(newLab);
  save(labsFile, all);
  res.json(newLab);
});

app.get("/api/appointments", auth, (req, res) => {
  const all = load(appointmentsFile);
  let list;
  if (req.user.role === "doctor") {
    list = all;
  } else {
    list = all.filter(a => a.patientId === req.user.username);
  }
  res.json(list);
});

app.post("/api/appointments", auth, (req, res) => {
  const { patientId, date, time, doctor, location, type } = req.body;
  if (!patientId || !date || !time || !doctor || !location || !type) {
    return res.status(400).json({ error: "MISSING_FIELDS" });
  }
  const all = load(appointmentsFile);
  const newAppt = {
    id: Date.now(),
    patientId,
    date,
    time,
    doctor,
    location,
    type
  };
  all.push(newAppt);
  save(appointmentsFile, all);
  res.json(newAppt);
});

app.delete("/api/appointments/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  const all = load(appointmentsFile);
  const idx = all.findIndex(a => a.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  const appt = all[idx];
  if (req.user.role !== "doctor" && appt.patientId !== req.user.username) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  all.splice(idx, 1);
  save(appointmentsFile, all);
  res.json({ ok: true });
});

//
// START SERVER
//
app.listen(port, () => {
  console.log("Mini-Maisa server running at http://localhost:" + port);
});

