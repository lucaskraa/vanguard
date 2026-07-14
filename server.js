'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  db,
  nowISO,
  randomToken,
  hashPassword,
  verifyPassword,
  serializeRows,
  sanitizeUser,
  findUserByEmail,
  findUserByAccessToken,
  findUserById,
  createSession,
  getSession,
  destroySession,
  getSettings,
  studentDashboard,
  teacherDashboard
} = require('./db');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(ROOT, 'uploads');
const MAX_BODY = 40 * 1024 * 1024;
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

function text(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

function sendFile(res, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webm': 'audio/webm',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg'
  };
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) return text(res, 404, 'Arquivo não encontrado.');
    res.writeHead(200, {
      'content-type': types[extension] || 'application/octet-stream',
      'content-length': stats.size,
      'cache-control': extension === '.html' ? 'no-cache' : 'public, max-age=300',
      'x-content-type-options': 'nosniff'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('O arquivo ou formulário ultrapassou o limite de 40 MB.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      const raw = Buffer.concat(chunks).toString('utf8');
      const type = String(req.headers['content-type'] || '');
      try {
        if (type.includes('application/json')) return resolve(JSON.parse(raw || '{}'));
        if (type.includes('application/x-www-form-urlencoded')) return resolve(Object.fromEntries(new URLSearchParams(raw)));
        resolve({ raw });
      } catch {
        reject(Object.assign(new Error('JSON inválido.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function cleanText(value, max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeAnswer(value) {
  return cleanText(value, 4000)
    .toLocaleLowerCase('en-US')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(expected, actual) {
  const a = normalizeAnswer(expected);
  const b = normalizeAnswer(actual);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const expectedWords = a.split(' ');
  const actualWords = new Set(b.split(' '));
  return expectedWords.filter((word) => actualWords.has(word)).length / expectedWords.length;
}

function tokenFromRequest(req, url) {
  const header = String(req.headers.authorization || '');
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return String(req.headers['x-session-token'] || url.searchParams.get('session') || '').trim();
}

function compilePattern(pattern) {
  const keys = [];
  const expression = pattern
    .split('/')
    .map((part) => {
      if (part.startsWith(':')) {
        keys.push(part.slice(1));
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${expression}$`), keys };
}

const routes = [];
function route(method, pattern, options, handler) {
  if (typeof options === 'function') {
    handler = options;
    options = {};
  }
  routes.push({ method, pattern, ...compilePattern(pattern), options, handler });
}

async function dispatch(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
    const file = path.join(UPLOAD_DIR, path.basename(pathname));
    return sendFile(res, file);
  }

  for (const item of routes) {
    if (item.method !== req.method) continue;
    const match = pathname.match(item.regex);
    if (!match) continue;
    const params = {};
    item.keys.forEach((key, index) => { params[key] = match[index + 1]; });
    let user = null;
    let sessionToken = '';
    if (item.options.auth) {
      sessionToken = tokenFromRequest(req, url);
      user = getSession(sessionToken);
      if (!user) return json(res, 401, { error: 'Sessão expirada ou encerrada por outro acesso.' });
      if (item.options.role && user.role !== item.options.role) return json(res, 403, { error: 'Acesso não autorizado.' });
    }
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    return item.handler({ req, res, url, params, body, user, sessionToken });
  }

  if (req.method === 'GET') {
    const staticFiles = new Set(['/index.html', '/styles.css', '/app.js', '/database.sql', '/package.json']);
    if (pathname === '/') return sendFile(res, path.join(ROOT, 'index.html'));
    if (staticFiles.has(pathname)) return sendFile(res, path.join(ROOT, pathname.slice(1)));
    if (!pathname.startsWith('/api/')) return sendFile(res, path.join(ROOT, 'index.html'));
  }

  return json(res, 404, { error: 'Rota não encontrada.' });
}

route('GET', '/api/health', ({ res }) => {
  json(res, 200, { ok: true, name: 'Vanguard English School', mode: 'node', time: nowISO() });
});

route('GET', '/api/access/:token', ({ res, params }) => {
  const student = findUserByAccessToken(cleanText(params.token, 220));
  if (!student || student.blocked) return json(res, 404, { error: 'Link individual inválido ou bloqueado.' });
  json(res, 200, { ok: true, student: { name: student.name, email: student.email, token: student.access_token } });
});

route('POST', '/api/login', ({ res, body }) => {
  const email = cleanText(body.email, 180).toLowerCase();
  const password = String(body.password || '');
  const accessToken = cleanText(body.accessToken, 220);
  const user = findUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) return json(res, 401, { error: 'E-mail ou senha incorretos.' });
  if (user.blocked) return json(res, 403, { error: 'Este acesso foi bloqueado pelo professor.' });
  if (user.role === 'student' && (!accessToken || accessToken !== user.access_token)) return json(res, 403, { error: 'O aluno precisa entrar pelo link individual enviado pelo professor.' });
  const session = createSession(user.id);
  json(res, 200, { ok: true, session, user: sanitizeUser(findUserById(user.id)) });
});

route('POST', '/api/logout', { auth: true }, ({ res, sessionToken }) => {
  destroySession(sessionToken);
  json(res, 200, { ok: true });
});

route('GET', '/api/me', { auth: true }, ({ res, user }) => {
  json(res, 200, { user, settings: getSettings() });
});

route('GET', '/api/student/dashboard', { auth: true, role: 'student' }, ({ res, user }) => {
  json(res, 200, studentDashboard(user.id));
});

route('GET', '/api/teacher/dashboard', { auth: true, role: 'teacher' }, ({ res }) => {
  json(res, 200, teacherDashboard());
});

route('POST', '/api/student/attempts', { auth: true, role: 'student' }, ({ res, user, body }) => {
  const activityId = Number(body.activityId);
  const answerText = cleanText(body.answerText, 5000);
  const transcript = cleanText(body.transcript, 5000);
  const audioUrl = cleanText(body.audioUrl, 1000);
  const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(activityId);
  if (!activity) return json(res, 404, { error: 'Atividade não encontrada.' });
  let score = 0;
  let correct = 0;
  let feedback = activity.explanation || 'Resposta enviada para o professor.';
  const response = transcript || answerText;
  if (activity.type === 'writing' && !activity.correct_answer) {
    score = Math.min(10, Math.max(4, Math.round(response.split(/\s+/).filter(Boolean).length / 2)));
    correct = response.length >= 8 ? 1 : 0;
    feedback = correct ? 'Resposta enviada. O professor poderá revisar sua escrita.' : 'Escreva uma frase mais completa.';
  } else if (activity.type === 'pronunciation') {
    const match = similarity(activity.correct_answer, response);
    score = Math.round(match * 100) / 10;
    correct = match >= .7 ? 1 : 0;
    feedback = correct ? 'Boa pronúncia! A frase reconhecida ficou próxima do modelo.' : activity.explanation;
  } else {
    const match = similarity(activity.correct_answer, response);
    correct = match >= .92 ? 1 : 0;
    score = correct ? Number(activity.points || 10) : Math.round(match * Number(activity.points || 10) * 10) / 10;
    feedback = correct ? 'Resposta correta!' : activity.explanation;
  }
  const result = db.prepare(`INSERT INTO attempts(activity_id, student_id, answer_text, audio_url, transcript, score, correct, feedback) VALUES(?,?,?,?,?,?,?,?)`)
    .run(activityId, user.id, answerText, audioUrl, transcript, score, correct, feedback);
  json(res, 201, {
    ok: true,
    attempt: { id: Number(result.lastInsertRowid), score, correct: Boolean(correct), feedback, expected: correct ? undefined : activity.correct_answer },
    dashboard: studentDashboard(user.id)
  });
});

route('POST', '/api/upload', { auth: true }, ({ res, body }) => {
  const name = path.basename(cleanText(body.name || 'arquivo.bin', 200));
  const type = cleanText(body.type || 'application/octet-stream', 120);
  const data = cleanText(body.data, MAX_BODY * 2);
  if (!/^(image|audio|video)\//.test(type)) return json(res, 400, { error: 'Envie somente imagem, áudio ou vídeo.' });
  const match = data.match(/^data:[^;]+;base64,(.+)$/);
  const base64 = match ? match[1] : data;
  let buffer;
  try { buffer = Buffer.from(base64, 'base64'); } catch { return json(res, 400, { error: 'Arquivo inválido.' }); }
  if (!buffer.length || buffer.length > 30 * 1024 * 1024) return json(res, 413, { error: 'O arquivo deve ter no máximo 30 MB.' });
  const extension = path.extname(name).slice(0, 12).toLowerCase() || ({ 'audio/webm': '.webm', 'audio/mpeg': '.mp3', 'image/png': '.png', 'image/jpeg': '.jpg', 'video/mp4': '.mp4' }[type] || '.bin');
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  json(res, 201, { ok: true, file: { name, type, size: buffer.length, url: `/uploads/${filename}` } });
});

route('POST', '/api/teacher/students', { auth: true, role: 'teacher' }, ({ res, body }) => {
  const name = cleanText(body.name, 120);
  const email = cleanText(body.email, 180).toLowerCase();
  const password = String(body.password || 'Aluno123');
  if (!name || !email.includes('@')) return json(res, 400, { error: 'Informe nome e e-mail válidos.' });
  if (findUserByEmail(email)) return json(res, 409, { error: 'Já existe um usuário com este e-mail.' });
  const accessToken = randomToken('student-');
  const avatar = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const result = db.prepare(`INSERT INTO users(role, name, email, password_hash, avatar, access_token) VALUES('student',?,?,?,?,?)`)
    .run(name, email, hashPassword(password), avatar, accessToken);
  json(res, 201, { ok: true, student: sanitizeUser(findUserById(Number(result.lastInsertRowid))), dashboard: teacherDashboard() });
});

route('PUT', '/api/teacher/students/:id', { auth: true, role: 'teacher' }, ({ res, params, body }) => {
  const id = Number(params.id);
  const student = findUserById(id);
  if (!student || student.role !== 'student') return json(res, 404, { error: 'Aluno não encontrado.' });
  const name = cleanText(body.name || student.name, 120);
  const email = cleanText(body.email || student.email, 180).toLowerCase();
  const blocked = body.blocked === undefined ? Number(student.blocked) : Number(Boolean(body.blocked));
  db.prepare('UPDATE users SET name = ?, email = ?, blocked = ?, updated_at = ? WHERE id = ?').run(name, email, blocked, nowISO(), id);
  json(res, 200, { ok: true, student: sanitizeUser(findUserById(id)), dashboard: teacherDashboard() });
});

route('DELETE', '/api/teacher/students/:id', { auth: true, role: 'teacher' }, ({ res, params }) => {
  const id = Number(params.id);
  const student = findUserById(id);
  if (!student || student.role !== 'student') return json(res, 404, { error: 'Aluno não encontrado.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  json(res, 200, { ok: true, dashboard: teacherDashboard() });
});

route('POST', '/api/teacher/students/:id/new-link', { auth: true, role: 'teacher' }, ({ res, params }) => {
  const id = Number(params.id);
  const student = findUserById(id);
  if (!student || student.role !== 'student') return json(res, 404, { error: 'Aluno não encontrado.' });
  const accessToken = randomToken('student-');
  db.prepare('UPDATE users SET access_token = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?').run(accessToken, nowISO(), id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  json(res, 200, { ok: true, student: sanitizeUser(findUserById(id)), dashboard: teacherDashboard() });
});

route('POST', '/api/teacher/units', { auth: true, role: 'teacher' }, ({ res, body }) => {
  const title = cleanText(body.title, 180);
  const description = cleanText(body.description, 1000);
  if (!title) return json(res, 400, { error: 'Informe o título da unidade.' });
  const position = db.prepare('SELECT COALESCE(MAX(position),0)+1 AS value FROM units').get().value;
  const result = db.prepare('INSERT INTO units(title, description, position, published) VALUES(?,?,?,1)').run(title, description, position);
  json(res, 201, { ok: true, id: Number(result.lastInsertRowid), dashboard: teacherDashboard() });
});

route('PUT', '/api/teacher/units/:id', { auth: true, role: 'teacher' }, ({ res, params, body }) => {
  const id = Number(params.id);
  const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(id);
  if (!unit) return json(res, 404, { error: 'Unidade não encontrada.' });
  db.prepare('UPDATE units SET title = ?, description = ?, published = ?, updated_at = ? WHERE id = ?')
    .run(cleanText(body.title || unit.title, 180), cleanText(body.description ?? unit.description, 1000), body.published === undefined ? unit.published : Number(Boolean(body.published)), nowISO(), id);
  json(res, 200, { ok: true, dashboard: teacherDashboard() });
});

route('DELETE', '/api/teacher/units/:id', { auth: true, role: 'teacher' }, ({ res, params }) => {
  db.prepare('DELETE FROM units WHERE id = ?').run(Number(params.id));
  json(res, 200, { ok: true, dashboard: teacherDashboard() });
});

route('POST', '/api/teacher/lessons', { auth: true, role: 'teacher' }, ({ res, body }) => {
  const unitId = Number(body.unitId);
  const title = cleanText(body.title, 180);
  if (!db.prepare('SELECT id FROM units WHERE id = ?').get(unitId)) return json(res, 400, { error: 'Selecione uma unidade válida.' });
  if (!title) return json(res, 400, { error: 'Informe o título da aula.' });
  const position = db.prepare('SELECT COALESCE(MAX(position),0)+1 AS value FROM lessons WHERE unit_id = ?').get(unitId).value;
  const result = db.prepare(`INSERT INTO lessons(unit_id,title,summary,written_content,examples_json,video_url,audio_url,image_url,position,published) VALUES(?,?,?,?,?,?,?,?,?,1)`)
    .run(unitId, title, cleanText(body.summary, 800), cleanText(body.writtenContent, 12000), JSON.stringify(body.examples || []), cleanText(body.videoUrl, 1000), cleanText(body.audioUrl, 1000), cleanText(body.imageUrl, 1000), position);
  json(res, 201, { ok: true, id: Number(result.lastInsertRowid), dashboard: teacherDashboard() });
});

route('POST', '/api/teacher/activities', { auth: true, role: 'teacher' }, ({ res, body }) => {
  const lessonId = Number(body.lessonId);
  if (!db.prepare('SELECT id FROM lessons WHERE id = ?').get(lessonId)) return json(res, 400, { error: 'Selecione uma aula válida.' });
  const allowed = ['multiple_choice','fill_blank','writing','listening','pronunciation'];
  const type = cleanText(body.type, 40);
  if (!allowed.includes(type)) return json(res, 400, { error: 'Tipo de atividade inválido.' });
  const title = cleanText(body.title, 180);
  const prompt = cleanText(body.prompt, 5000);
  if (!title || !prompt) return json(res, 400, { error: 'Informe título e enunciado.' });
  const position = db.prepare('SELECT COALESCE(MAX(position),0)+1 AS value FROM activities WHERE lesson_id = ?').get(lessonId).value;
  const result = db.prepare(`INSERT INTO activities(lesson_id,week_label,title,type,prompt,options_json,correct_answer,explanation,media_url,required,points,due_at,position) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(lessonId, cleanText(body.weekLabel || 'Semana atual', 100), title, type, prompt, JSON.stringify(Array.isArray(body.options) ? body.options : []), cleanText(body.correctAnswer, 3000), cleanText(body.explanation, 5000), cleanText(body.mediaUrl, 1000), Number(body.required !== false), Math.max(1, Math.min(100, Number(body.points || 10))), cleanText(body.dueAt, 100) || null, position);
  json(res, 201, { ok: true, id: Number(result.lastInsertRowid), dashboard: teacherDashboard() });
});

route('DELETE', '/api/teacher/activities/:id', { auth: true, role: 'teacher' }, ({ res, params }) => {
  db.prepare('DELETE FROM activities WHERE id = ?').run(Number(params.id));
  json(res, 200, { ok: true, dashboard: teacherDashboard() });
});

route('POST', '/api/teacher/notices', { auth: true, role: 'teacher' }, ({ res, user, body }) => {
  const title = cleanText(body.title, 180);
  const message = cleanText(body.message, 5000);
  const studentId = body.studentId ? Number(body.studentId) : null;
  if (!title || !message) return json(res, 400, { error: 'Informe título e mensagem.' });
  db.prepare('INSERT INTO notices(teacher_id, student_id, title, message) VALUES(?,?,?,?)').run(user.id, studentId, title, message);
  json(res, 201, { ok: true, dashboard: teacherDashboard() });
});

route('POST', '/api/teacher/live-classes', { auth: true, role: 'teacher' }, ({ res, body }) => {
  const settings = getSettings();
  const title = cleanText(body.title, 180);
  const startsAt = cleanText(body.startsAt, 100);
  if (!title || !startsAt) return json(res, 400, { error: 'Informe título e data da aula.' });
  const result = db.prepare(`INSERT INTO live_classes(title,starts_at,duration_minutes,minimum_percent,room_url,status) VALUES(?,?,?,?,?,'scheduled')`)
    .run(title, startsAt, Number(body.durationMinutes || 60), Number(body.minimumPercent || settings.live_minimum_percent), cleanText(body.roomUrl || settings.live_room_url, 1000));
  json(res, 201, { ok: true, id: Number(result.lastInsertRowid), dashboard: teacherDashboard() });
});

route('PUT', '/api/teacher/live-classes/:id', { auth: true, role: 'teacher' }, ({ res, params, body }) => {
  const id = Number(params.id);
  const item = db.prepare('SELECT * FROM live_classes WHERE id = ?').get(id);
  if (!item) return json(res, 404, { error: 'Aula ao vivo não encontrada.' });
  db.prepare(`UPDATE live_classes SET title=?,starts_at=?,duration_minutes=?,minimum_percent=?,room_url=?,status=?,updated_at=? WHERE id=?`)
    .run(cleanText(body.title || item.title,180), cleanText(body.startsAt || item.starts_at,100), Number(body.durationMinutes || item.duration_minutes), Number(body.minimumPercent || item.minimum_percent), cleanText(body.roomUrl || item.room_url,1000), cleanText(body.status || item.status,20), nowISO(), id);
  json(res, 200, { ok: true, dashboard: teacherDashboard() });
});

route('POST', '/api/live/:id/ping', { auth: true, role: 'student' }, ({ res, params, user, body }) => {
  const liveId = Number(params.id);
  const liveClass = db.prepare('SELECT * FROM live_classes WHERE id = ?').get(liveId);
  if (!liveClass) return json(res, 404, { error: 'Aula não encontrada.' });
  const existing = db.prepare('SELECT * FROM live_presence WHERE live_class_id = ? AND student_id = ?').get(liveId, user.id);
  const increment = Math.max(0, Math.min(60, Number(body.seconds || 15)));
  if (!existing) db.prepare(`INSERT INTO live_presence(live_class_id,student_id,joined_at,last_ping_at,seconds_present,percentage,status) VALUES(?,?,?,?,?,0,'pending')`).run(liveId,user.id,nowISO(),nowISO(),increment);
  else db.prepare('UPDATE live_presence SET last_ping_at=?, seconds_present=seconds_present+? WHERE id=?').run(nowISO(),increment,existing.id);
  const presence = db.prepare('SELECT * FROM live_presence WHERE live_class_id=? AND student_id=?').get(liveId,user.id);
  const percentage = Math.min(100, Math.round((Number(presence.seconds_present) / Math.max(1, Number(liveClass.duration_minutes)*60)) * 1000) / 10);
  const status = percentage >= Number(liveClass.minimum_percent) ? 'present' : 'pending';
  db.prepare('UPDATE live_presence SET percentage=?,status=? WHERE id=?').run(percentage,status,presence.id);
  json(res, 200, { ok: true, presence: { ...presence, percentage, status } });
});

route('GET', '/api/live/:id/questions', { auth: true }, ({ res, params, user }) => {
  const liveId = Number(params.id);
  let rows;
  if (user.role === 'teacher') {
    rows = db.prepare(`SELECT q.*,u.name AS selected_student_name,(SELECT COUNT(*) FROM live_answers a WHERE a.question_id=q.id) AS answer_count FROM live_questions q LEFT JOIN users u ON u.id=q.selected_student_id WHERE q.live_class_id=? ORDER BY q.id DESC`).all(liveId);
  } else {
    rows = db.prepare(`SELECT q.id,q.live_class_id,q.prompt,q.response_type,q.time_limit_seconds,q.published,q.answers_released,q.selected_student_id,CASE WHEN q.answers_released=1 THEN q.correct_answer ELSE '' END AS correct_answer,(SELECT answer_text FROM live_answers a WHERE a.question_id=q.id AND a.student_id=?) AS own_answer,(SELECT audio_url FROM live_answers a WHERE a.question_id=q.id AND a.student_id=?) AS own_audio FROM live_questions q WHERE q.live_class_id=? AND q.published=1 ORDER BY q.id DESC`).all(user.id,user.id,liveId);
  }
  json(res, 200, { questions: serializeRows(rows) });
});

route('POST', '/api/teacher/live/:id/questions', { auth: true, role: 'teacher' }, ({ res, params, body }) => {
  const liveId = Number(params.id);
  const prompt = cleanText(body.prompt, 5000);
  if (!prompt) return json(res, 400, { error: 'Informe a pergunta.' });
  const result = db.prepare(`INSERT INTO live_questions(live_class_id,prompt,correct_answer,response_type,time_limit_seconds,published,answers_released) VALUES(?,?,?,?,?,0,0)`)
    .run(liveId,prompt,cleanText(body.correctAnswer,3000),body.responseType==='audio'?'audio':'text',Math.max(10,Math.min(600,Number(body.timeLimitSeconds||60))));
  json(res, 201, { ok: true, id: Number(result.lastInsertRowid) });
});

route('PUT', '/api/teacher/live/questions/:id', { auth: true, role: 'teacher' }, ({ res, params, body }) => {
  const id = Number(params.id);
  const question = db.prepare('SELECT * FROM live_questions WHERE id=?').get(id);
  if (!question) return json(res,404,{error:'Pergunta não encontrada.'});
  db.prepare('UPDATE live_questions SET published=?,answers_released=?,selected_student_id=? WHERE id=?')
    .run(body.published===undefined?question.published:Number(Boolean(body.published)),body.answersReleased===undefined?question.answers_released:Number(Boolean(body.answersReleased)),body.selectedStudentId?Number(body.selectedStudentId):null,id);
  json(res,200,{ok:true});
});

route('POST', '/api/live/questions/:id/answer', { auth: true, role: 'student' }, ({ res, params, user, body }) => {
  const questionId = Number(params.id);
  const question = db.prepare('SELECT * FROM live_questions WHERE id=? AND published=1').get(questionId);
  if (!question) return json(res,404,{error:'Pergunta indisponível.'});
  db.prepare(`INSERT INTO live_answers(question_id,student_id,answer_text,audio_url) VALUES(?,?,?,?) ON CONFLICT(question_id,student_id) DO UPDATE SET answer_text=excluded.answer_text,audio_url=excluded.audio_url,created_at=CURRENT_TIMESTAMP`)
    .run(questionId,user.id,cleanText(body.answerText,5000),cleanText(body.audioUrl,1000));
  json(res,201,{ok:true});
});

route('GET', '/api/teacher/live/questions/:id/answers', { auth: true, role: 'teacher' }, ({ res, params }) => {
  const rows = db.prepare(`SELECT a.*,u.name AS student_name,u.email AS student_email FROM live_answers a JOIN users u ON u.id=a.student_id WHERE a.question_id=? ORDER BY a.created_at`).all(Number(params.id));
  json(res,200,{answers:serializeRows(rows)});
});

route('PUT', '/api/teacher/absences/:id', { auth: true, role: 'teacher' }, ({ res, params, body }) => {
  const id = Number(params.id);
  const absence = db.prepare('SELECT * FROM absences WHERE id=?').get(id);
  if (!absence) return json(res,404,{error:'Falta não encontrada.'});
  db.prepare('UPDATE absences SET justified=?,reason=? WHERE id=?').run(Number(Boolean(body.justified)),cleanText(body.reason??absence.reason,1000),id);
  json(res,200,{ok:true,dashboard:teacherDashboard()});
});

route('DELETE', '/api/teacher/absences/:id', { auth: true, role: 'teacher' }, ({ res, params }) => {
  db.prepare('DELETE FROM absences WHERE id=?').run(Number(params.id));
  json(res,200,{ok:true,dashboard:teacherDashboard()});
});

route('PUT', '/api/teacher/settings', { auth: true, role: 'teacher' }, ({ res, body }) => {
  const current = getSettings();
  db.prepare(`UPDATE settings SET school_name=?,course_name=?,weekly_minimum_percent=?,live_minimum_percent=?,live_room_url=?,timezone=?,content_protection=?,updated_at=? WHERE id=1`)
    .run(cleanText(body.schoolName||current.school_name,180),cleanText(body.courseName||current.course_name,180),Math.max(1,Math.min(100,Number(body.weeklyMinimumPercent||current.weekly_minimum_percent))),Math.max(1,Math.min(100,Number(body.liveMinimumPercent||current.live_minimum_percent))),cleanText(body.liveRoomUrl||current.live_room_url,1000),cleanText(body.timezone||current.timezone,100),body.contentProtection===undefined?Number(current.content_protection):Number(Boolean(body.contentProtection)),nowISO());
  json(res,200,{ok:true,dashboard:teacherDashboard()});
});

route('GET', '/api/teacher/reports/:studentId', { auth: true, role: 'teacher' }, ({ res, params }) => {
  const studentId = Number(params.studentId);
  const student = findUserById(studentId);
  if (!student || student.role !== 'student') return json(res,404,{error:'Aluno não encontrado.'});
  json(res,200,studentDashboard(studentId));
});

const server = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type, authorization, x-session-token');
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  dispatch(req, res).catch((error) => {
    console.error(error);
    const status = Number(error.status || (String(error.message).includes('UNIQUE constraint failed') ? 409 : 500));
    json(res, status, { error: status === 409 ? 'Já existe um registro com esses dados.' : (error.message || 'Erro interno do servidor.') });
  });
});

async function runSelfTest() {
  const port = 3400 + Math.floor(Math.random() * 500);
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await fetch(`${base}/api/health`).then((response) => response.json());
    if (!health.ok) throw new Error('Health check falhou.');
    const login = await fetch(`${base}/api/login`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({email:'professor@vanguard.demo',password:'Professor123'}) }).then((response)=>response.json());
    if (!login.session) throw new Error(`Login falhou: ${login.error || 'sem sessão'}`);
    const dashboard = await fetch(`${base}/api/teacher/dashboard`, { headers:{authorization:`Bearer ${login.session}`} }).then((response)=>response.json());
    if (!dashboard.students?.length || !dashboard.units?.length) throw new Error('Dashboard incompleto.');
    const css = await fetch(`${base}/styles.css`).then((response)=>response.text());
    const js = await fetch(`${base}/app.js`).then((response)=>response.text());
    if (!css.includes('--css-ready:1')) throw new Error('CSS não carregou.');
    if (!js.includes('VanguardApp')) throw new Error('JavaScript não carregou.');
    console.log('SELF-TEST OK: servidor, SQLite, login, dashboard, CSS e JavaScript funcionando.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv.includes('--self-test')) {
  runSelfTest().catch((error) => { console.error(error); process.exitCode = 1; });
} else {
  server.listen(PORT, '0.0.0.0', () => console.log(`Vanguard English School: http://localhost:${PORT}`));
}
