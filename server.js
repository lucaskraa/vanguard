const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const multer = require('multer');
const { initDb, getDb, weekKey } = require('./db');

const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 10);
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 80 * 1024 * 1024 }
});

function cleanText(value = '') {
  return String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
  const x = cleanText(a);
  const y = cleanText(b);
  const matrix = Array.from({ length: y.length + 1 }, () => Array(x.length + 1).fill(0));
  for (let i = 0; i <= y.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= x.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= y.length; i += 1) {
    for (let j = 1; j <= x.length; j += 1) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (y[i - 1] === x[j - 1] ? 0 : 1)
      );
    }
  }
  return matrix[y.length][x.length];
}

function similarity(a, b) {
  const x = cleanText(a);
  const y = cleanText(b);
  if (!x || !y) return 0;
  return Math.max(0, 1 - levenshtein(x, y) / Math.max(x.length, y.length));
}

function parseJson(value, fallback = []) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function randomToken(name = 'aluno') {
  const slug = cleanText(name).replace(/\s+/g, '-').replace(/'/g, '') || 'aluno';
  return `${slug}-${crypto.randomBytes(4).toString('hex')}`;
}

function auth(req, res, next) {
  const db = getDb();
  if (!req.session?.userId || !req.session?.sessionToken) {
    return res.status(401).json({ error: 'Faça login para continuar.' });
  }
  const user = db.get(
    `SELECT id,role,name,email,active,access_token,session_token FROM users WHERE id=?`,
    [req.session.userId]
  );
  if (!user || !Number(user.active) || user.session_token !== req.session.sessionToken) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Sua sessão expirou ou foi aberta em outro aparelho.' });
  }
  req.user = user;
  next();
}

function role(expected) {
  return (req, res, next) => {
    if (req.user?.role !== expected) return res.status(403).json({ error: 'Acesso não permitido.' });
    next();
  };
}

function getSettings() {
  const rows = getDb().all('SELECT key,value FROM settings');
  return Object.fromEntries(rows.map(row => [row.key, row.value]));
}

function studentStats(studentId) {
  const db = getDb();
  const total = Number(db.get(`SELECT COUNT(*) total FROM activities WHERE published=1`).total || 0);
  const completed = Number(db.get(`SELECT COUNT(*) total FROM submissions WHERE student_id=?`, [studentId]).total || 0);
  const grade = Number(db.get(`SELECT COALESCE(AVG(score),0) average FROM submissions WHERE student_id=?`, [studentId]).average || 0);
  const absences = Number(db.get(`SELECT COUNT(*) total FROM absences WHERE student_id=? AND justified=0`, [studentId]).total || 0);
  return { total, completed, progress: total ? Math.round(completed * 100 / total) : 0, grade: Math.round(grade * 10) / 10, absences };
}

function evaluateOnlineAbsences() {
  const db = getDb();
  const settings = getSettings();
  const minPercent = Number(settings.online_min_percent || 70);
  const weeks = db.all(`SELECT week_key,MAX(deadline) deadline,COUNT(*) required
                        FROM activities WHERE required=1 AND published=1 GROUP BY week_key`);
  const students = db.all(`SELECT id FROM users WHERE role='student' AND active=1`);
  const now = Date.now();
  for (const week of weeks) {
    if (!week.deadline || new Date(week.deadline).getTime() > now) continue;
    for (const student of students) {
      const done = Number(db.get(
        `SELECT COUNT(*) total FROM submissions s JOIN activities a ON a.id=s.activity_id
         WHERE s.student_id=? AND a.week_key=? AND a.required=1`,
        [student.id, week.week_key]
      ).total || 0);
      const percent = Number(week.required) ? done * 100 / Number(week.required) : 100;
      if (percent < minPercent) {
        db.run(
          `INSERT OR IGNORE INTO absences(student_id,kind,week_key,reason)
           VALUES(?,'online',?,?)`,
          [student.id, week.week_key, `Concluiu ${Math.round(percent)}% das atividades obrigatórias. Mínimo: ${minPercent}%.`]
        );
      }
    }
  }
}

function evaluateLiveAbsences(liveId) {
  const db = getDb();
  const live = db.get('SELECT * FROM live_classes WHERE id=?', [liveId]);
  if (!live) return;
  const expected = Math.max(1, Math.round((new Date(live.ends_at) - new Date(live.starts_at)) / 1000));
  const wk = weekKey(new Date(live.starts_at));
  const students = db.all(`SELECT id FROM users WHERE role='student' AND active=1`);
  for (const student of students) {
    const att = db.get(`SELECT seconds_present FROM live_attendance WHERE live_id=? AND student_id=?`, [liveId, student.id]);
    const percent = att ? Number(att.seconds_present) * 100 / expected : 0;
    if (percent < Number(live.minimum_percent)) {
      db.run(
        `INSERT OR IGNORE INTO absences(student_id,kind,week_key,live_id,reason)
         VALUES(?,'live',?,?,?)`,
        [student.id, wk, live.id, `Participação de ${Math.round(percent)}%. Mínimo: ${live.minimum_percent}%.`]
      );
    }
  }
}

function registerRoutes(app) {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    const db = getDb();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const accessToken = String(req.body.accessToken || '').trim();
    const user = db.get(`SELECT * FROM users WHERE lower(email)=?`, [email]);
    if (!user || !Number(user.active) || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }
    if (user.role === 'student' && (!accessToken || user.access_token !== accessToken)) {
      return res.status(403).json({ error: 'Este link não pertence ao e-mail informado.' });
    }
    const sessionToken = crypto.randomBytes(24).toString('hex');
    db.run(`UPDATE users SET session_token=? WHERE id=?`, [sessionToken, user.id]);
    req.session.userId = user.id;
    req.session.sessionToken = sessionToken;
    req.session.save(() => res.json({ ok: true, role: user.role }));
  });

  router.post('/logout', auth, (req, res) => {
    getDb().run(`UPDATE users SET session_token=NULL WHERE id=?`, [req.user.id]);
    req.session.destroy(() => res.json({ ok: true }));
  });

  router.get('/me', auth, (req, res) => {
    res.json({
      user: {
        id: req.user.id,
        role: req.user.role,
        name: req.user.name,
        email: req.user.email,
        accessToken: req.user.access_token
      },
      settings: getSettings()
    });
  });

  router.get('/student/dashboard', auth, role('student'), (req, res) => {
    evaluateOnlineAbsences();
    const db = getDb();
    const week = weekKey();
    const stats = studentStats(req.user.id);
    const weekly = db.all(
      `SELECT a.*,l.title lesson_title,u.title unit_title,s.score,s.submitted_at
       FROM activities a JOIN lessons l ON l.id=a.lesson_id JOIN units u ON u.id=l.unit_id
       LEFT JOIN submissions s ON s.activity_id=a.id AND s.student_id=?
       WHERE a.published=1 AND a.week_key=? ORDER BY a.position`,
      [req.user.id, week]
    ).map(row => ({ ...row, options: parseJson(row.options_json) }));
    const live = db.get(`SELECT * FROM live_classes WHERE status!='finished' ORDER BY starts_at LIMIT 1`);
    const notices = db.all(
      `SELECT * FROM notices WHERE target_student_id IS NULL OR target_student_id=? ORDER BY created_at DESC LIMIT 4`,
      [req.user.id]
    );
    res.json({ stats, weekly, live, notices, week });
  });

  router.get('/student/week', auth, role('student'), (req, res) => {
    const db = getDb();
    const week = req.query.week || weekKey();
    const activities = db.all(
      `SELECT a.*,l.title lesson_title,u.id unit_id,u.title unit_title,s.score,s.is_correct,s.submitted_at,s.feedback
       FROM activities a JOIN lessons l ON l.id=a.lesson_id JOIN units u ON u.id=l.unit_id
       LEFT JOIN submissions s ON s.activity_id=a.id AND s.student_id=?
       WHERE a.published=1 AND a.week_key=? ORDER BY u.position,l.position,a.position`,
      [req.user.id, week]
    ).map(row => ({ ...row, options: parseJson(row.options_json) }));
    res.json({ week, activities });
  });

  router.get('/student/units', auth, role('student'), (req, res) => {
    const units = getDb().all(`SELECT * FROM units WHERE published=1 ORDER BY position,id`);
    res.json({ units });
  });

  router.get('/student/units/:id', auth, role('student'), (req, res) => {
    const db = getDb();
    const unit = db.get(`SELECT * FROM units WHERE id=? AND published=1`, [req.params.id]);
    if (!unit) return res.status(404).json({ error: 'Unidade não encontrada.' });
    const lessons = db.all(`SELECT * FROM lessons WHERE unit_id=? AND published=1 ORDER BY position,id`, [unit.id]);
    lessons.forEach(lesson => {
      lesson.activities = db.all(
        `SELECT a.*,s.score,s.is_correct,s.submitted_at,s.feedback
         FROM activities a LEFT JOIN submissions s ON s.activity_id=a.id AND s.student_id=?
         WHERE a.lesson_id=? AND a.published=1 ORDER BY a.position`,
        [req.user.id, lesson.id]
      ).map(row => ({ ...row, options: parseJson(row.options_json) }));
    });
    res.json({ unit, lessons });
  });

  router.post('/student/activities/:id/submit', auth, role('student'), upload.single('audio'), (req, res) => {
    const db = getDb();
    const activity = db.get(`SELECT * FROM activities WHERE id=? AND published=1`, [req.params.id]);
    if (!activity) return res.status(404).json({ error: 'Atividade não encontrada.' });
    const answer = String(req.body.answer || req.body.transcript || '').trim();
    const transcript = String(req.body.transcript || '').trim();
    let score = 0;
    let isCorrect = 0;
    let feedback = 'Resposta enviada para o professor.';
    if (activity.correct_answer) {
      const ratio = activity.type === 'pronunciation'
        ? similarity(transcript || answer, activity.pronunciation_target || activity.correct_answer)
        : similarity(answer, activity.correct_answer);
      isCorrect = ratio >= (activity.type === 'pronunciation' ? 0.72 : 0.93) ? 1 : 0;
      score = Math.round(Number(activity.points) * ratio * 10) / 10;
      feedback = isCorrect
        ? 'Muito bem! Sua resposta está correta.'
        : `${activity.explanation || 'Revise o conteúdo e tente novamente.'}`;
    }
    const old = db.get(`SELECT id,attempts FROM submissions WHERE activity_id=? AND student_id=?`, [activity.id, req.user.id]);
    const audioPath = req.file ? `/uploads/${req.file.filename}` : null;
    if (old) {
      db.run(
        `UPDATE submissions SET answer_text=?,transcript=?,audio_path=COALESCE(?,audio_path),score=?,is_correct=?,attempts=?,feedback=?,submitted_at=CURRENT_TIMESTAMP WHERE id=?`,
        [answer, transcript, audioPath, score, isCorrect, Number(old.attempts) + 1, feedback, old.id]
      );
    } else {
      db.run(
        `INSERT INTO submissions(activity_id,student_id,answer_text,transcript,audio_path,score,is_correct,feedback)
         VALUES(?,?,?,?,?,?,?,?)`,
        [activity.id, req.user.id, answer, transcript, audioPath, score, isCorrect, feedback]
      );
    }
    res.json({ ok: true, score, isCorrect: Boolean(isCorrect), feedback, transcript, audioPath });
  });

  router.get('/student/progress', auth, role('student'), (req, res) => {
    const db = getDb();
    evaluateOnlineAbsences();
    const stats = studentStats(req.user.id);
    const submissions = db.all(
      `SELECT s.*,a.title activity_title,a.type,u.title unit_title
       FROM submissions s JOIN activities a ON a.id=s.activity_id
       JOIN lessons l ON l.id=a.lesson_id JOIN units u ON u.id=l.unit_id
       WHERE s.student_id=? ORDER BY s.submitted_at DESC`,
      [req.user.id]
    );
    const absences = db.all(`SELECT * FROM absences WHERE student_id=? ORDER BY created_at DESC`, [req.user.id]);
    res.json({ stats, submissions, absences });
  });

  router.get('/student/notices', auth, role('student'), (req, res) => {
    const notices = getDb().all(
      `SELECT * FROM notices WHERE target_student_id IS NULL OR target_student_id=? ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ notices });
  });

  router.get('/student/profile', auth, role('student'), (req, res) => {
    res.json({ user: req.user, link: `/index.html?token=${encodeURIComponent(req.user.access_token)}` });
  });

  router.put('/student/profile', auth, role('student'), async (req, res) => {
    const db = getDb();
    const name = String(req.body.name || '').trim();
    if (name) db.run(`UPDATE users SET name=? WHERE id=?`, [name, req.user.id]);
    if (req.body.password) {
      if (String(req.body.password).length < 8) return res.status(400).json({ error: 'A senha precisa ter pelo menos 8 caracteres.' });
      db.run(`UPDATE users SET password_hash=? WHERE id=?`, [await bcrypt.hash(String(req.body.password), 10), req.user.id]);
    }
    res.json({ ok: true });
  });

  router.get('/student/live', auth, role('student'), (req, res) => {
    const db = getDb();
    const live = db.get(`SELECT * FROM live_classes WHERE status!='finished' ORDER BY starts_at LIMIT 1`)
      || db.get(`SELECT * FROM live_classes ORDER BY starts_at DESC LIMIT 1`);
    if (!live) return res.json({ live: null, question: null });
    const question = db.get(
      `SELECT q.*,u.name chosen_student_name FROM live_questions q
       LEFT JOIN users u ON u.id=q.chosen_student_id
       WHERE q.live_id=? AND q.published=1 ORDER BY q.id DESC LIMIT 1`,
      [live.id]
    );
    const myAnswer = question ? db.get(`SELECT * FROM live_answers WHERE question_id=? AND student_id=?`, [question.id, req.user.id]) : null;
    const classAnswers = question && Number(question.revealed)
      ? db.all(`SELECT a.answer_text,a.audio_path,a.submitted_at,u.name student_name
                FROM live_answers a JOIN users u ON u.id=a.student_id
                WHERE a.question_id=? ORDER BY a.submitted_at`, [question.id])
      : [];
    const safeQuestion = question ? {
      ...question,
      correct_answer: Number(question.revealed) ? question.correct_answer : null
    } : null;
    res.json({ live, question: safeQuestion, myAnswer, classAnswers });
  });

  router.post('/student/live/:id/join', auth, role('student'), (req, res) => {
    const db = getDb();
    db.run(
      `INSERT INTO live_attendance(live_id,student_id,seconds_present) VALUES(?,?,0)
       ON CONFLICT(live_id,student_id) DO UPDATE SET last_seen_at=CURRENT_TIMESTAMP`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  });

  router.post('/student/live/:id/heartbeat', auth, role('student'), (req, res) => {
    getDb().run(
      `UPDATE live_attendance SET seconds_present=seconds_present+15,last_seen_at=CURRENT_TIMESTAMP WHERE live_id=? AND student_id=?`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  });

  router.post('/student/questions/:id/answer', auth, role('student'), upload.single('audio'), (req, res) => {
    const db = getDb();
    const question = db.get(`SELECT * FROM live_questions WHERE id=? AND published=1`, [req.params.id]);
    if (!question) return res.status(404).json({ error: 'Pergunta não encontrada.' });
    const text = String(req.body.answer || '').trim();
    const audioPath = req.file ? `/uploads/${req.file.filename}` : null;
    db.run(
      `INSERT INTO live_answers(question_id,student_id,answer_text,audio_path) VALUES(?,?,?,?)
       ON CONFLICT(question_id,student_id) DO UPDATE SET answer_text=excluded.answer_text,audio_path=COALESCE(excluded.audio_path,live_answers.audio_path),submitted_at=CURRENT_TIMESTAMP`,
      [question.id, req.user.id, text, audioPath]
    );
    res.json({ ok: true });
  });

  router.get('/teacher/dashboard', auth, role('teacher'), (req, res) => {
    evaluateOnlineAbsences();
    const db = getDb();
    const cards = {
      students: Number(db.get(`SELECT COUNT(*) total FROM users WHERE role='student' AND active=1`).total || 0),
      activities: Number(db.get(`SELECT COUNT(*) total FROM activities WHERE published=1`).total || 0),
      submissions: Number(db.get(`SELECT COUNT(*) total FROM submissions`).total || 0),
      absences: Number(db.get(`SELECT COUNT(*) total FROM absences WHERE justified=0`).total || 0)
    };
    const currentWeek = weekKey();
    const students = db.all(`SELECT id,name,email,active,access_token FROM users WHERE role='student' ORDER BY name`).map(student => {
      const weeklyTotal = Number(db.get(`SELECT COUNT(*) total FROM activities WHERE published=1 AND required=1 AND week_key=?`, [currentWeek]).total || 0);
      const delivered = Number(db.get(`SELECT COUNT(*) total FROM submissions s JOIN activities a ON a.id=s.activity_id
                                       WHERE s.student_id=? AND a.published=1 AND a.required=1 AND a.week_key=?`, [student.id, currentWeek]).total || 0);
      const late = Number(db.get(`SELECT COUNT(*) total FROM submissions s JOIN activities a ON a.id=s.activity_id
                                  WHERE s.student_id=? AND a.published=1 AND a.required=1 AND a.week_key=?
                                  AND a.deadline IS NOT NULL AND datetime(s.submitted_at) > datetime(a.deadline)`, [student.id, currentWeek]).total || 0);
      return { ...student, ...studentStats(student.id), weeklyTotal, delivered, late, missing: Math.max(0, weeklyTotal - delivered) };
    });
    const live = db.get(`SELECT * FROM live_classes WHERE status!='finished' ORDER BY starts_at LIMIT 1`);
    res.json({ cards, students, live, currentWeek });
  });

  router.get('/teacher/students', auth, role('teacher'), (req, res) => {
    const students = getDb().all(`SELECT id,name,email,active,access_token,created_at FROM users WHERE role='student' ORDER BY name`)
      .map(s => ({ ...s, ...studentStats(s.id) }));
    res.json({ students });
  });

  router.post('/teacher/students', auth, role('teacher'), async (req, res) => {
    const db = getDb();
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || 'Aluno123');
    if (!name || !email) return res.status(400).json({ error: 'Informe nome e e-mail.' });
    if (db.get(`SELECT id FROM users WHERE lower(email)=?`, [email])) return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    const token = randomToken(name);
    const result = db.run(
      `INSERT INTO users(role,name,email,password_hash,active,access_token) VALUES('student',?,?,?,?,?)`,
      [name, email, await bcrypt.hash(password, 10), 1, token]
    );
    res.json({ ok: true, id: result.lastID, password, token, link: `/index.html?token=${token}` });
  });

  router.put('/teacher/students/:id', auth, role('teacher'), async (req, res) => {
    const db = getDb();
    const student = db.get(`SELECT * FROM users WHERE id=? AND role='student'`, [req.params.id]);
    if (!student) return res.status(404).json({ error: 'Aluno não encontrado.' });
    db.run(`UPDATE users SET name=?,email=?,active=? WHERE id=?`, [
      String(req.body.name || student.name).trim(),
      String(req.body.email || student.email).trim().toLowerCase(),
      req.body.active === undefined ? student.active : Number(Boolean(req.body.active)),
      student.id
    ]);
    if (req.body.password) db.run(`UPDATE users SET password_hash=? WHERE id=?`, [await bcrypt.hash(String(req.body.password), 10), student.id]);
    res.json({ ok: true });
  });

  router.delete('/teacher/students/:id', auth, role('teacher'), (req, res) => {
    getDb().run(`DELETE FROM users WHERE id=? AND role='student'`, [req.params.id]);
    res.json({ ok: true });
  });

  router.post('/teacher/students/:id/new-link', auth, role('teacher'), (req, res) => {
    const db = getDb();
    const student = db.get(`SELECT name FROM users WHERE id=? AND role='student'`, [req.params.id]);
    if (!student) return res.status(404).json({ error: 'Aluno não encontrado.' });
    const token = randomToken(student.name);
    db.run(`UPDATE users SET access_token=?,session_token=NULL WHERE id=?`, [token, req.params.id]);
    res.json({ ok: true, token, link: `/index.html?token=${token}` });
  });

  router.get('/teacher/curriculum', auth, role('teacher'), (req, res) => {
    const db = getDb();
    const units = db.all(`SELECT * FROM units ORDER BY position,id`);
    units.forEach(unit => {
      unit.lessons = db.all(`SELECT * FROM lessons WHERE unit_id=? ORDER BY position,id`, [unit.id]);
      unit.lessons.forEach(lesson => {
        lesson.activities = db.all(`SELECT * FROM activities WHERE lesson_id=? ORDER BY position,id`, [lesson.id])
          .map(a => ({ ...a, options: parseJson(a.options_json) }));
      });
    });
    res.json({ units, week: weekKey() });
  });

  router.post('/teacher/units', auth, role('teacher'), (req, res) => {
    const title = String(req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Informe o título da unidade.' });
    const result = getDb().run(`INSERT INTO units(title,description,position,published) VALUES(?,?,?,1)`, [title, req.body.description || '', Number(req.body.position || 1)]);
    res.json({ ok: true, id: result.lastID });
  });

  router.post('/teacher/lessons', auth, role('teacher'), (req, res) => {
    const result = getDb().run(
      `INSERT INTO lessons(unit_id,title,content,video_url,image_url,audio_url,position,published) VALUES(?,?,?,?,?,?,?,1)`,
      [Number(req.body.unitId), req.body.title, req.body.content || '', req.body.videoUrl || null, req.body.imageUrl || null, req.body.audioUrl || null, Number(req.body.position || 1)]
    );
    res.json({ ok: true, id: result.lastID });
  });

  router.post('/teacher/activities', auth, role('teacher'), (req, res) => {
    const result = getDb().run(
      `INSERT INTO activities(lesson_id,title,type,prompt,options_json,correct_answer,explanation,pronunciation_target,media_url,required,points,week_key,deadline,position,published)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      [
        Number(req.body.lessonId), req.body.title, req.body.type, req.body.prompt,
        JSON.stringify(req.body.options || []), req.body.correctAnswer || '', req.body.explanation || '',
        req.body.pronunciationTarget || '', req.body.mediaUrl || null, Number(req.body.required !== false),
        Number(req.body.points || 10), req.body.weekKey || weekKey(), req.body.deadline || null, Number(req.body.position || 1)
      ]
    );
    res.json({ ok: true, id: result.lastID });
  });

  router.post('/teacher/upload', auth, role('teacher'), upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
    res.json({ ok: true, url: `/uploads/${req.file.filename}`, name: req.file.originalname });
  });

  router.get('/teacher/attendance', auth, role('teacher'), (req, res) => {
    evaluateOnlineAbsences();
    const db = getDb();
    const lives = db.all(`SELECT * FROM live_classes ORDER BY starts_at DESC`);
    lives.filter(l => l.status === 'finished' || new Date(l.ends_at) < new Date()).forEach(l => evaluateLiveAbsences(l.id));
    const absences = db.all(
      `SELECT a.*,u.name student_name,u.email FROM absences a JOIN users u ON u.id=a.student_id ORDER BY a.created_at DESC`
    );
    const attendance = db.all(
      `SELECT la.*,u.name student_name,l.title live_title,l.starts_at,l.ends_at,l.minimum_percent
       FROM live_attendance la JOIN users u ON u.id=la.student_id JOIN live_classes l ON l.id=la.live_id
       ORDER BY l.starts_at DESC,u.name`
    );
    res.json({ absences, attendance, lives });
  });

  router.put('/teacher/absences/:id', auth, role('teacher'), (req, res) => {
    getDb().run(`UPDATE absences SET justified=?,reason=COALESCE(?,reason) WHERE id=?`, [Number(Boolean(req.body.justified)), req.body.reason || null, req.params.id]);
    res.json({ ok: true });
  });

  router.delete('/teacher/absences/:id', auth, role('teacher'), (req, res) => {
    getDb().run(`DELETE FROM absences WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  });

  router.get('/teacher/reports', auth, role('teacher'), (req, res) => {
    const students = getDb().all(`SELECT id,name,email,active FROM users WHERE role='student' ORDER BY name`).map(s => ({ ...s, ...studentStats(s.id) }));
    res.json({ students });
  });

  router.get('/teacher/reports/:id', auth, role('teacher'), (req, res) => {
    const db = getDb();
    const student = db.get(`SELECT id,name,email,active,created_at FROM users WHERE id=? AND role='student'`, [req.params.id]);
    if (!student) return res.status(404).json({ error: 'Aluno não encontrado.' });
    const submissions = db.all(
      `SELECT s.*,a.title activity_title,a.type,a.deadline,u.title unit_title,
              CASE WHEN a.deadline IS NOT NULL AND datetime(s.submitted_at) > datetime(a.deadline) THEN 1 ELSE 0 END is_late
       FROM submissions s
       JOIN activities a ON a.id=s.activity_id JOIN lessons l ON l.id=a.lesson_id JOIN units u ON u.id=l.unit_id
       WHERE s.student_id=? ORDER BY s.submitted_at DESC`, [student.id]
    );
    const absences = db.all(`SELECT * FROM absences WHERE student_id=? ORDER BY created_at DESC`, [student.id]);
    res.json({ student: { ...student, ...studentStats(student.id) }, submissions, absences });
  });

  router.post('/teacher/notices', auth, role('teacher'), (req, res) => {
    const result = getDb().run(
      `INSERT INTO notices(title,message,target_student_id,created_by) VALUES(?,?,?,?)`,
      [req.body.title, req.body.message, req.body.targetStudentId || null, req.user.id]
    );
    res.json({ ok: true, id: result.lastID });
  });

  router.put('/teacher/settings', auth, role('teacher'), (req, res) => {
    const db = getDb();
    Object.entries(req.body || {}).forEach(([key, value]) => {
      db.run(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [key, String(value)]);
    });
    res.json({ ok: true, settings: getSettings() });
  });

  router.get('/teacher/live', auth, role('teacher'), (req, res) => {
    const db = getDb();
    const live = db.get(`SELECT * FROM live_classes WHERE status!='finished' ORDER BY starts_at LIMIT 1`)
      || db.get(`SELECT * FROM live_classes ORDER BY starts_at DESC LIMIT 1`);
    if (!live) return res.json({ live: null, question: null, answers: [] });
    const question = db.get(`SELECT * FROM live_questions WHERE live_id=? ORDER BY id DESC LIMIT 1`, [live.id]);
    const answers = question ? db.all(
      `SELECT a.*,u.name student_name FROM live_answers a JOIN users u ON u.id=a.student_id WHERE a.question_id=? ORDER BY a.submitted_at`,
      [question.id]
    ) : [];
    const students = db.all(`SELECT id,name FROM users WHERE role='student' AND active=1 ORDER BY name`);
    res.json({ live, question, answers, students });
  });

  router.post('/teacher/live', auth, role('teacher'), (req, res) => {
    const start = new Date(req.body.startsAt || Date.now()).toISOString();
    const end = new Date(req.body.endsAt || Date.now() + 3600000).toISOString();
    const result = getDb().run(
      `INSERT INTO live_classes(title,description,starts_at,ends_at,room_url,minimum_percent,status) VALUES(?,?,?,?,?,?,?)`,
      [req.body.title, req.body.description || '', start, end, req.body.roomUrl || `https://meet.jit.si/VanguardEnglish-${crypto.randomBytes(4).toString('hex')}`, Number(req.body.minimumPercent || 75), req.body.status || 'scheduled']
    );
    res.json({ ok: true, id: result.lastID });
  });

  router.put('/teacher/live/:id', auth, role('teacher'), (req, res) => {
    const db = getDb();
    const live = db.get(`SELECT * FROM live_classes WHERE id=?`, [req.params.id]);
    if (!live) return res.status(404).json({ error: 'Aula não encontrada.' });
    db.run(
      `UPDATE live_classes SET title=?,description=?,starts_at=?,ends_at=?,room_url=?,minimum_percent=?,status=? WHERE id=?`,
      [req.body.title || live.title, req.body.description ?? live.description, req.body.startsAt || live.starts_at, req.body.endsAt || live.ends_at, req.body.roomUrl || live.room_url, Number(req.body.minimumPercent || live.minimum_percent), req.body.status || live.status, live.id]
    );
    if ((req.body.status || live.status) === 'finished') evaluateLiveAbsences(live.id);
    res.json({ ok: true });
  });

  router.post('/teacher/live/:id/questions', auth, role('teacher'), (req, res) => {
    const result = getDb().run(
      `INSERT INTO live_questions(live_id,prompt,correct_answer,seconds_to_answer,published,revealed) VALUES(?,?,?,?,1,0)`,
      [req.params.id, req.body.prompt, req.body.correctAnswer || '', Number(req.body.seconds || 30)]
    );
    res.json({ ok: true, id: result.lastID });
  });

  router.put('/teacher/questions/:id', auth, role('teacher'), (req, res) => {
    const db = getDb();
    const q = db.get(`SELECT * FROM live_questions WHERE id=?`, [req.params.id]);
    if (!q) return res.status(404).json({ error: 'Pergunta não encontrada.' });
    db.run(
      `UPDATE live_questions SET revealed=?,chosen_student_id=? WHERE id=?`,
      [req.body.revealed === undefined ? q.revealed : Number(Boolean(req.body.revealed)), req.body.chosenStudentId === undefined ? q.chosen_student_id : (req.body.chosenStudentId || null), q.id]
    );
    res.json({ ok: true });
  });

  app.use('/api', router);
}


async function start() {
  await initDb();
  const app = express();
  const port = Number(process.env.PORT || 3000);

  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(session({
    name: 'vanguard.sid',
    secret: process.env.SESSION_SECRET || 'vanguard-desenvolvimento-troque-em-producao',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 60 * 60 * 1000 }
  }));

  registerRoutes(app);
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
  const sendNoCache = file => (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, file));
  };
  app.get(['/', '/index.html'], sendNoCache('index.html'));
  app.get('/styles.css', sendNoCache('styles.css'));
  app.get('/app.js', sendNoCache('app.js'));
  app.get('/access/:token', (req, res) => res.redirect(`/index.html?token=${encodeURIComponent(req.params.token)}`));
  app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'Vanguard English School' }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  app.use((error, _req, res, _next) => {
    console.error(error);
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Arquivo maior que 80 MB.' });
    return res.status(500).json({ error: 'Erro interno. Veja o terminal do servidor.' });
  });

  app.listen(port, () => {
    console.log('\n============================================================');
    console.log('  VANGUARD ENGLISH SCHOOL — PLATAFORMA INICIADA');
    console.log('============================================================');
    console.log(`Acesse: http://localhost:${port}`);
    console.log('Professor: professor@vanguard.demo / Professor123');
    console.log(`Aluno: http://localhost:${port}/index.html?token=ana-vanguard-demo`);
    console.log('Aluno: ana@vanguard.demo / Aluno123');
    console.log('Não abra index.html com dois cliques; use o endereço acima.');
    console.log('============================================================\n');
  });
}

start().catch(error => {
  console.error('Não foi possível iniciar:', error);
  process.exit(1);
});
