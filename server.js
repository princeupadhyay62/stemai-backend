require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.warn("WARNING: DATABASE_URL is not set.");
}
if (!process.env.JWT_SECRET) {
  console.warn("WARNING: JWT_SECRET is not set.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

const allowedOrigins = (process.env.CLIENT_ORIGIN || "*")
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins.includes("*") ? true : allowedOrigins,
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required" });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function validGrade(grade) {
  const n = Number(grade);
  return Number.isInteger(n) && n >= 1 && n <= 12;
}

app.get("/", (_req, res) => {
  res.json({
    name: "STEMAI Backend API",
    status: "running",
    version: "1.0.0",
    endpoints: ["/api/health", "/api/auth/signup", "/api/auth/login", "/api/tutor/ask"]
  });
});

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch (e) {
    res.status(503).json({ ok: false, database: "not connected", error: e.message });
  }
});

/* AUTH */
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, email, password, grade } = req.body;
    if (!name || !email || !password || !validGrade(grade)) {
      return res.status(400).json({ error: "Name, email, password and class 1-12 are required." });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await pool.query("SELECT id FROM users WHERE email=$1", [normalizedEmail]);
    if (existing.rowCount) return res.status(409).json({ error: "Email already registered." });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users(name,email,password_hash,grade)
       VALUES($1,$2,$3,$4)
       RETURNING id,name,email,grade,created_at`,
      [String(name).trim(), normalizedEmail, hash, Number(grade)]
    );

    const user = result.rows[0];
    const token = signToken(user);
    res.status(201).json({ token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Signup failed." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

    const result = await pool.query("SELECT * FROM users WHERE email=$1", [
      String(email).trim().toLowerCase()
    ]);
    if (!result.rowCount) return res.status(401).json({ error: "Invalid email or password." });

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password." });

    delete user.password_hash;
    const token = signToken(user);
    res.json({ token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Login failed." });
  }
});

app.get("/api/auth/me", auth, async (req, res) => {
  const result = await pool.query(
    "SELECT id,name,email,grade,created_at FROM users WHERE id=$1",
    [req.user.sub]
  );
  if (!result.rowCount) return res.status(404).json({ error: "User not found." });
  res.json({ user: result.rows[0] });
});

/* AI TUTOR */
function demoTutorAnswer(question, grade, subject) {
  const q = question.toLowerCase();
  if (q.includes("photosynthesis")) {
    return `For Class ${grade}, photosynthesis is the process by which green plants use sunlight to make food from carbon dioxide and water. Oxygen is released as a by-product.`;
  }
  if (q.includes("newton")) {
    return `For Class ${grade}, Newton's laws describe how forces affect motion. A key relation is F = ma, meaning force equals mass multiplied by acceleration.`;
  }
  if (q.includes("dna")) {
    return `DNA stores hereditary information in living organisms. It contains instructions that help cells grow, develop and function.`;
  }
  return `Here is a Class ${grade} ${subject}-level explanation of "${question}": start with the core concept, connect it to a simple real-world example, and then move to formulas or deeper details when appropriate. This is the demo fallback; connect an AI API key to generate real model responses.`;
}

app.post("/api/tutor/ask", auth, async (req, res) => {
  try {
    const { question, subject = "Science", grade } = req.body;
    if (!question?.trim()) return res.status(400).json({ error: "Question is required." });

    const userResult = await pool.query("SELECT grade FROM users WHERE id=$1", [req.user.sub]);
    const userGrade = userResult.rows[0]?.grade || 12;
    const finalGrade = validGrade(grade) ? Number(grade) : userGrade;

    await pool.query(
      `INSERT INTO chat_messages(user_id,role,content,subject,grade)
       VALUES($1,'user',$2,$3,$4)`,
      [req.user.sub, question.trim(), subject, finalGrade]
    );

    let answer = null;

    if (process.env.AI_API_KEY && process.env.AI_MODEL) {
      const base = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
      const response = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.AI_API_KEY}`
        },
        body: JSON.stringify({
          model: process.env.AI_MODEL,
          temperature: 0.4,
          messages: [
            {
              role: "system",
              content: `You are STEMAI, a safe educational tutor. Adapt vocabulary, depth and examples to Class ${finalGrade}. Subject: ${subject}. Explain clearly and never pretend a guess is a verified fact.`
            },
            { role: "user", content: question.trim() }
          ]
        })
      });

      if (response.ok) {
        const data = await response.json();
        answer = data.choices?.[0]?.message?.content?.trim() || null;
      }
    }

    if (!answer) answer = demoTutorAnswer(question.trim(), finalGrade, subject);

    await pool.query(
      `INSERT INTO chat_messages(user_id,role,content,subject,grade)
       VALUES($1,'assistant',$2,$3,$4)`,
      [req.user.sub, answer, subject, finalGrade]
    );

    res.json({ answer, grade: finalGrade, subject });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Tutor request failed." });
  }
});

app.get("/api/tutor/history", auth, async (req, res) => {
  const result = await pool.query(
    `SELECT id,role,content,subject,grade,created_at
     FROM chat_messages WHERE user_id=$1 ORDER BY created_at ASC LIMIT 200`,
    [req.user.sub]
  );
  res.json({ messages: result.rows });
});

/* PROGRESS */
app.get("/api/progress", auth, async (req, res) => {
  const result = await pool.query(
    `SELECT subject,progress,updated_at FROM progress
     WHERE user_id=$1 ORDER BY subject`,
    [req.user.sub]
  );
  res.json({ progress: result.rows });
});

app.put("/api/progress", auth, async (req, res) => {
  const { subject, progress } = req.body;
  const value = Number(progress);
  if (!subject || !Number.isInteger(value) || value < 0 || value > 100) {
    return res.status(400).json({ error: "Subject and progress 0-100 are required." });
  }

  const result = await pool.query(
    `INSERT INTO progress(user_id,subject,progress,updated_at)
     VALUES($1,$2,$3,NOW())
     ON CONFLICT(user_id,subject)
     DO UPDATE SET progress=EXCLUDED.progress,updated_at=NOW()
     RETURNING subject,progress,updated_at`,
    [req.user.sub, subject, value]
  );
  res.json({ progress: result.rows[0] });
});

/* QUIZ */
app.post("/api/quizzes/attempt", auth, async (req, res) => {
  const { quizName, score, total } = req.body;
  const s = Number(score), t = Number(total);
  if (!quizName || !Number.isInteger(s) || !Number.isInteger(t) || t <= 0 || s < 0 || s > t) {
    return res.status(400).json({ error: "Valid quizName, score and total are required." });
  }
  const result = await pool.query(
    `INSERT INTO quiz_attempts(user_id,quiz_name,score,total)
     VALUES($1,$2,$3,$4)
     RETURNING id,quiz_name,score,total,created_at`,
    [req.user.sub, quizName, s, t]
  );
  res.status(201).json({ attempt: result.rows[0] });
});

app.get("/api/quizzes/attempts", auth, async (req, res) => {
  const result = await pool.query(
    `SELECT id,quiz_name,score,total,created_at
     FROM quiz_attempts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [req.user.sub]
  );
  res.json({ attempts: result.rows });
});

/* FEEDBACK */
app.post("/api/feedback", auth, async (req, res) => {
  const { rating, message } = req.body;
  const r = Number(rating);
  if (!message?.trim() || !Number.isInteger(r) || r < 1 || r > 5) {
    return res.status(400).json({ error: "Rating 1-5 and feedback message are required." });
  }
  const result = await pool.query(
    `INSERT INTO feedback(user_id,rating,message)
     VALUES($1,$2,$3) RETURNING id,rating,message,created_at`,
    [req.user.sub, r, message.trim()]
  );
  res.status(201).json({ feedback: result.rows[0] });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, () => {
  console.log(`STEMAI backend running on port ${PORT}`);
});
