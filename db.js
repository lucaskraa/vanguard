'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : ROOT;
const DB_FILE = process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(DATA_DIR, 'vanguard.sqlite');
const SCHEMA_FILE = path.join(ROOT, 'database.sql');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

function nowISO() {
  return new Date().toISOString();
}

function plusDays(days, hour = 19) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function randomToken(prefix = '') {
  return `${prefix}${crypto.randomBytes(20).toString('hex')}`;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [kind, salt, expectedHex] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !expectedHex) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function parseJSON(value, fallback = []) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function serializeRows(rows) {
  return rows.map((row) => ({
    ...row,
    options: row.options_json !== undefined ? parseJSON(row.options_json) : undefined,
    examples: row.examples_json !== undefined ? parseJSON(row.examples_json) : undefined,
    blocked: row.blocked !== undefined ? Boolean(row.blocked) : undefined,
    required: row.required !== undefined ? Boolean(row.required) : undefined,
    published: row.published !== undefined ? Boolean(row.published) : undefined,
    correct: row.correct !== undefined ? Boolean(row.correct) : undefined,
    justified: row.justified !== undefined ? Boolean(row.justified) : undefined,
    answers_released: row.answers_released !== undefined ? Boolean(row.answers_released) : undefined,
    content_protection: row.content_protection !== undefined ? Boolean(row.content_protection) : undefined
  }));
}

function initialize() {
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  db.exec(schema);
  seed();
}

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) AS total FROM users').get().total;
  if (userCount > 0) return;

  db.exec('BEGIN');
  try {
    const insertUser = db.prepare(`
      INSERT INTO users(role, name, email, password_hash, avatar, blocked, access_token)
      VALUES(@role, @name, @email, @password_hash, @avatar, 0, @access_token)
    `);

    const teacherHash = hashPassword('Professor123');
    const studentHash = hashPassword('Aluno123');

    const teacherId = Number(insertUser.run({
      role: 'teacher',
      name: 'Professora Marina',
      email: 'professor@vanguard.demo',
      password_hash: teacherHash,
      avatar: 'PM',
      access_token: null
    }).lastInsertRowid);

    const students = [
      ['Ana Souza', 'ana@vanguard.demo', 'ana-vanguard-demo', 'AS'],
      ['Bruno Lima', 'bruno@vanguard.demo', 'bruno-vanguard-demo', 'BL'],
      ['Camila Rocha', 'camila@vanguard.demo', 'camila-vanguard-demo', 'CR'],
      ['Diego Martins', 'diego@vanguard.demo', 'diego-vanguard-demo', 'DM']
    ];

    const studentIds = [];
    for (const [name, email, token, avatar] of students) {
      studentIds.push(Number(insertUser.run({
        role: 'student',
        name,
        email,
        password_hash: studentHash,
        avatar,
        access_token: token
      }).lastInsertRowid));
    }

    db.prepare(`
      INSERT INTO settings(id, school_name, course_name, weekly_minimum_percent, live_minimum_percent, live_room_url, timezone, content_protection)
      VALUES(1, 'Vanguard English School', 'English Hybrid', 70, 75, 'https://meet.jit.si/VanguardEnglishDemoRoom', 'America/Sao_Paulo', 1)
    `).run();

    const insertUnit = db.prepare('INSERT INTO units(title, description, position, published) VALUES(?,?,?,1)');
    const unit1 = Number(insertUnit.run('Unit 1 — Everyday English', 'Rotina, hábitos e conversas do dia a dia.', 1).lastInsertRowid);
    const unit2 = Number(insertUnit.run('Unit 2 — Real Conversations', 'Escuta, respostas rápidas e situações reais.', 2).lastInsertRowid);
    const unit3 = Number(insertUnit.run('Unit 3 — Plans and Experiences', 'Planos, experiências e comunicação com confiança.', 3).lastInsertRowid);

    const insertLesson = db.prepare(`
      INSERT INTO lessons(unit_id, title, summary, written_content, examples_json, video_url, audio_url, image_url, position, published)
      VALUES(?,?,?,?,?,?,?,?,?,1)
    `);

    const lesson1 = Number(insertLesson.run(
      unit1,
      'Present Continuous',
      'Como falar sobre ações que estão acontecendo agora.',
      'Usamos am, is ou are + verbo com -ing. Exemplo: I am studying now. She is speaking with the teacher.',
      JSON.stringify(['I am reading now.', 'They are practicing English.', 'He is not sleeping.']),
      'https://www.youtube.com/embed/OLx3IrlVf6Y',
      '',
      '',
      1
    ).lastInsertRowid);

    const lesson2 = Number(insertLesson.run(
      unit1,
      'Daily Routines',
      'Vocabulário e frases para descrever sua rotina.',
      'Use o Simple Present para hábitos: I wake up at seven. She studies in the afternoon.',
      JSON.stringify(['I usually have breakfast at 7.', 'She goes to school by bus.', 'We practice every week.']),
      '',
      '',
      '',
      2
    ).lastInsertRowid);

    const lesson3 = Number(insertLesson.run(
      unit2,
      'Listening in Context',
      'Treino de escuta com perguntas curtas.',
      'Ouça primeiro sem ler. Depois identifique palavras-chave e responda com uma frase completa.',
      JSON.stringify(['Could you repeat that?', 'What do you mean?', 'I understand now.']),
      '',
      '',
      '',
      1
    ).lastInsertRowid);

    const lesson4 = Number(insertLesson.run(
      unit3,
      'Talking about Plans',
      'Use going to para falar de planos.',
      'Estrutura: subject + be + going to + verb. Exemplo: I am going to study tonight.',
      JSON.stringify(['We are going to travel.', 'Are you going to join the class?', 'She is not going to miss it.']),
      '',
      '',
      '',
      1
    ).lastInsertRowid);

    const insertActivity = db.prepare(`
      INSERT INTO activities(lesson_id, week_label, title, type, prompt, options_json, correct_answer, explanation, media_url, required, points, due_at, position)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    const week = 'Semana atual';
    const due = plusDays(5, 23);
    const activityIds = [];

    activityIds.push(Number(insertActivity.run(
      lesson1, week, 'Escolha a frase correta', 'multiple_choice',
      'Qual frase descreve uma ação acontecendo agora?',
      JSON.stringify(['I study English every Monday.', 'I am studying English now.', 'I studied English yesterday.']),
      'I am studying English now.',
      'Para uma ação acontecendo neste momento, use am/is/are + verbo com -ing.',
      '', 1, 10, due, 1
    ).lastInsertRowid));

    activityIds.push(Number(insertActivity.run(
      lesson1, week, 'Complete a frase', 'fill_blank',
      'She ___ speaking with the teacher.',
      JSON.stringify([]), 'is',
      'Com she usamos is: She is speaking.',
      '', 1, 10, due, 2
    ).lastInsertRowid));

    activityIds.push(Number(insertActivity.run(
      lesson2, week, 'Escreva sobre sua rotina', 'writing',
      'Escreva uma frase em inglês contando o que você faz pela manhã.',
      JSON.stringify([]), '',
      'Use o Simple Present e tente incluir um horário.',
      '', 1, 10, due, 3
    ).lastInsertRowid));

    activityIds.push(Number(insertActivity.run(
      lesson3, week, 'Listening practice', 'listening',
      'Ouça o áudio do professor e escreva a frase principal.',
      JSON.stringify([]), 'Could you repeat that?',
      'A expressão é usada para pedir que alguém repita o que disse.',
      '', 1, 10, due, 4
    ).lastInsertRowid));

    activityIds.push(Number(insertActivity.run(
      lesson1, week, 'Pronunciation challenge', 'pronunciation',
      'Leia em voz alta: I am practicing English every day.',
      JSON.stringify([]), 'I am practicing English every day.',
      'Fale com calma e destaque os sons de practicing e every.',
      '', 1, 10, due, 5
    ).lastInsertRowid));

    const insertAttempt = db.prepare(`
      INSERT INTO attempts(activity_id, student_id, answer_text, transcript, score, correct, feedback)
      VALUES(?,?,?,?,?,?,?)
    `);

    insertAttempt.run(activityIds[0], studentIds[0], 'I am studying English now.', '', 10, 1, 'Muito bem!');
    insertAttempt.run(activityIds[1], studentIds[0], 'is', '', 10, 1, 'Resposta correta.');
    insertAttempt.run(activityIds[2], studentIds[0], 'I have breakfast at seven.', '', 8, 1, 'Boa frase.');
    insertAttempt.run(activityIds[0], studentIds[1], 'I study English every Monday.', '', 3, 0, 'Revise o Present Continuous.');

    const insertNotice = db.prepare('INSERT INTO notices(teacher_id, student_id, title, message) VALUES(?,?,?,?)');
    insertNotice.run(teacherId, null, 'Bem-vindos à nova semana', 'As atividades ficam disponíveis até domingo às 23h. Na aula ao vivo vamos praticar conversação.');
    insertNotice.run(teacherId, studentIds[0], 'Ótimo progresso, Ana!', 'Você concluiu as primeiras atividades. Continue praticando a pronúncia.');

    const liveId = Number(db.prepare(`
      INSERT INTO live_classes(title, starts_at, duration_minutes, minimum_percent, room_url, status)
      VALUES(?,?,?,?,?,?)
    `).run('Conversation Club — Everyday English', plusDays(3, 19), 60, 75, 'https://meet.jit.si/VanguardEnglishDemoRoom', 'scheduled').lastInsertRowid);

    db.prepare(`
      INSERT INTO live_questions(live_class_id, prompt, correct_answer, response_type, time_limit_seconds, published, answers_released)
      VALUES(?,?,?,?,?,?,?)
    `).run(liveId, 'What are you doing right now?', 'I am studying English.', 'text', 60, 0, 0);

    db.prepare('INSERT INTO absences(student_id, kind, reference_key, reason, justified) VALUES(?,?,?,?,?)')
      .run(studentIds[2], 'online', '2026-W28', 'Não concluiu a porcentagem mínima da semana.', 0);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getSettings() {
  return serializeRows([db.prepare('SELECT * FROM settings WHERE id = 1').get()])[0];
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return { ...safe, blocked: Boolean(safe.blocked) };
}

function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(String(email || '').trim());
}

function findUserByAccessToken(token) {
  return db.prepare("SELECT * FROM users WHERE access_token = ? AND role = 'student'").get(token);
}

function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
}

function createSession(userId) {
  const user = findUserById(userId);
  if (!user) throw new Error('Usuário não encontrado.');
  const nextVersion = Number(user.session_version || 0) + 1;
  db.prepare('UPDATE users SET session_version = ?, updated_at = ? WHERE id = ?').run(nextVersion, nowISO(), userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  const token = randomToken('vs_');
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  db.prepare('INSERT INTO sessions(token, user_id, session_version, expires_at) VALUES(?,?,?,?)')
    .run(token, userId, nextVersion, expires);
  return token;
}

function getSession(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.token, s.expires_at, s.session_version AS session_session_version, u.*
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  if (Number(row.session_session_version) !== Number(row.session_version) || row.blocked) return null;
  return sanitizeUser(row);
}

function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function listUnitsWithLessons() {
  const units = serializeRows(db.prepare('SELECT * FROM units ORDER BY position, id').all());
  const lessons = serializeRows(db.prepare('SELECT * FROM lessons ORDER BY unit_id, position, id').all());
  const activities = serializeRows(db.prepare('SELECT * FROM activities ORDER BY lesson_id, position, id').all());
  return units.map((unit) => ({
    ...unit,
    lessons: lessons.filter((lesson) => lesson.unit_id === unit.id).map((lesson) => ({
      ...lesson,
      activities: activities.filter((activity) => activity.lesson_id === lesson.id)
    }))
  }));
}

function studentDashboard(studentId) {
  const student = sanitizeUser(findUserById(studentId));
  const settings = getSettings();
  const activities = serializeRows(db.prepare(`
    SELECT a.*, l.title AS lesson_title, u.title AS unit_title,
      (SELECT MAX(score) FROM attempts at WHERE at.activity_id = a.id AND at.student_id = ?) AS best_score,
      (SELECT COUNT(*) FROM attempts at WHERE at.activity_id = a.id AND at.student_id = ?) AS attempt_count
    FROM activities a
    JOIN lessons l ON l.id = a.lesson_id
    JOIN units u ON u.id = l.unit_id
    WHERE a.required = 1 AND a.published = 1 AND l.published = 1 AND u.published = 1
    ORDER BY a.due_at, a.position
  `).all(studentId, studentId));

  const completed = activities.filter((activity) => Number(activity.attempt_count || 0) > 0).length;
  const progress = activities.length ? Math.round((completed / activities.length) * 100) : 0;
  const scores = db.prepare('SELECT MAX(score) AS score FROM attempts WHERE student_id = ? GROUP BY activity_id').all(studentId);
  const grade = scores.length ? Math.round((scores.reduce((sum, row) => sum + Number(row.score || 0), 0) / (scores.length * 10)) * 100) / 10 : 0;
  const absences = serializeRows(db.prepare('SELECT * FROM absences WHERE student_id = ? ORDER BY created_at DESC').all(studentId));
  const notices = serializeRows(db.prepare(`
    SELECT n.*, u.name AS teacher_name FROM notices n
    JOIN users u ON u.id = n.teacher_id
    WHERE n.student_id IS NULL OR n.student_id = ?
    ORDER BY n.created_at DESC LIMIT 20
  `).all(studentId));
  const liveClass = serializeRows(db.prepare("SELECT * FROM live_classes WHERE status != 'finished' ORDER BY starts_at LIMIT 1").all())[0] || null;
  const attempts = serializeRows(db.prepare(`
    SELECT at.*, a.title AS activity_title, a.type AS activity_type
    FROM attempts at JOIN activities a ON a.id = at.activity_id
    WHERE at.student_id = ? ORDER BY at.created_at DESC
  `).all(studentId));

  return {
    student,
    settings,
    summary: { progress, grade, absences: absences.filter((item) => !item.justified).length, completed, total: activities.length },
    activities,
    units: listUnitsWithLessons(),
    notices,
    absences,
    liveClass,
    attempts
  };
}

function teacherDashboard() {
  const students = serializeRows(db.prepare("SELECT id, role, name, email, avatar, blocked, access_token, created_at FROM users WHERE role = 'student' ORDER BY name").all());
  const units = listUnitsWithLessons();
  const notices = serializeRows(db.prepare(`
    SELECT n.*, s.name AS student_name FROM notices n
    LEFT JOIN users s ON s.id = n.student_id
    ORDER BY n.created_at DESC LIMIT 30
  `).all());
  const liveClasses = serializeRows(db.prepare('SELECT * FROM live_classes ORDER BY starts_at DESC').all());
  const absences = serializeRows(db.prepare(`
    SELECT a.*, u.name AS student_name, u.email AS student_email
    FROM absences a JOIN users u ON u.id = a.student_id
    ORDER BY a.created_at DESC
  `).all());
  const recentAttempts = serializeRows(db.prepare(`
    SELECT at.*, u.name AS student_name, a.title AS activity_title, a.type AS activity_type
    FROM attempts at
    JOIN users u ON u.id = at.student_id
    JOIN activities a ON a.id = at.activity_id
    ORDER BY at.created_at DESC LIMIT 40
  `).all());

  const reports = students.map((student) => {
    const dashboard = studentDashboard(student.id);
    return {
      ...student,
      progress: dashboard.summary.progress,
      grade: dashboard.summary.grade,
      absences: dashboard.summary.absences,
      completed: dashboard.summary.completed,
      total: dashboard.summary.total
    };
  });

  return {
    settings: getSettings(),
    summary: {
      students: students.length,
      activeStudents: students.filter((student) => !student.blocked).length,
      units: units.length,
      activities: units.reduce((sum, unit) => sum + unit.lessons.reduce((inner, lesson) => inner + lesson.activities.length, 0), 0),
      pending: reports.filter((report) => report.progress < getSettings().weekly_minimum_percent).length
    },
    students,
    units,
    notices,
    liveClasses,
    absences,
    attempts: recentAttempts,
    reports
  };
}

initialize();

module.exports = {
  db,
  nowISO,
  plusDays,
  randomToken,
  hashPassword,
  verifyPassword,
  parseJSON,
  serializeRows,
  sanitizeUser,
  findUserByEmail,
  findUserByAccessToken,
  findUserById,
  createSession,
  getSession,
  destroySession,
  getSettings,
  listUnitsWithLessons,
  studentDashboard,
  teacherDashboard
};
