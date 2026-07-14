const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

let rawDb;
let db;
const DB_FILE = path.join(__dirname, 'vanguard.sqlite');

function normalize(params) {
  if (params === undefined || params === null) return [];
  return Array.isArray(params) ? params : [params];
}

function persist() {
  if (!rawDb) return;
  fs.writeFileSync(DB_FILE, Buffer.from(rawDb.export()));
}

function adapter(database) {
  return {
    run(sql, params = []) {
      const stmt = database.prepare(sql);
      try {
        stmt.bind(normalize(params));
        while (stmt.step()) {}
      } finally {
        stmt.free();
      }
      const meta = database.exec('SELECT last_insert_rowid() AS id, changes() AS changes');
      persist();
      return {
        lastID: Number(meta[0]?.values?.[0]?.[0] || 0),
        changes: Number(meta[0]?.values?.[0]?.[1] || 0)
      };
    },
    get(sql, params = []) {
      const stmt = database.prepare(sql);
      try {
        stmt.bind(normalize(params));
        return stmt.step() ? stmt.getAsObject() : undefined;
      } finally {
        stmt.free();
      }
    },
    all(sql, params = []) {
      const stmt = database.prepare(sql);
      const rows = [];
      try {
        stmt.bind(normalize(params));
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
      } finally {
        stmt.free();
      }
    },
    exec(sql) {
      database.run(sql);
      persist();
    }
  };
}

function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - start) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function futureIso(days, hour = 19) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function seed() {
  const count = db.get('SELECT COUNT(*) total FROM users');
  if (Number(count.total) > 0) return;

  const teacherHash = await bcrypt.hash('Professor123', 10);
  const studentHash = await bcrypt.hash('Aluno123', 10);
  const teacher = db.run(
    `INSERT INTO users(role,name,email,password_hash,active) VALUES('teacher',?,?,?,1)`,
    ['Professora Marina', 'professor@vanguard.demo', teacherHash]
  );
  const ana = db.run(
    `INSERT INTO users(role,name,email,password_hash,active,access_token) VALUES('student',?,?,?,?,?)`,
    ['Ana Souza', 'ana@vanguard.demo', studentHash, 1, 'ana-vanguard-demo']
  );
  db.run(
    `INSERT INTO users(role,name,email,password_hash,active,access_token) VALUES('student',?,?,?,?,?)`,
    ['Lucas Lima', 'lucas@vanguard.demo', studentHash, 1, 'lucas-vanguard-demo']
  );

  const unit = db.run(
    `INSERT INTO units(title,description,position,published) VALUES(?,?,1,1)`,
    ['Unit 1 — Everyday English', 'Saudações, apresentações e expressões usadas no cotidiano.']
  );
  const lesson = db.run(
    `INSERT INTO lessons(unit_id,title,content,position,published) VALUES(?,?,?,?,1)`,
    [unit.lastID, 'Lesson 1 — Introductions', 'Use “My name is...”, “I am from...” e “Nice to meet you” para se apresentar.', 1]
  );

  const week = weekKey();
  const deadline = futureIso(5, 23);
  const items = [
    ['Choose the greeting','multiple_choice','Qual frase significa “Prazer em conhecer você”?',JSON.stringify(['See you later','Nice to meet you','Good night','Excuse me']),'Nice to meet you','“Nice to meet you” é usado quando conhecemos alguém.',null],
    ['Complete the sentence','fill_blank','Complete: My name ___ Ana.',null,'is','Depois de “My name”, usamos “is”.',null],
    ['Write about yourself','writing','Escreva em inglês: “Meu nome é Ana e eu sou do Brasil.”',null,'my name is ana and i am from brazil','Use “My name is...” e “I am from...”.',null],
    ['Listening practice','listening','Escreva a saudação principal do áudio da aula.',null,'good morning','A resposta esperada é “Good morning”.',null],
    ['Pronunciation','pronunciation','Clique no microfone e diga: Nice to meet you.',null,'nice to meet you','Fale de forma clara e sem correr.','nice to meet you']
  ];
  items.forEach((item, index) => {
    db.run(
      `INSERT INTO activities(lesson_id,title,type,prompt,options_json,correct_answer,explanation,pronunciation_target,required,points,week_key,deadline,position,published)
       VALUES(?,?,?,?,?,?,?,?,1,10,?,?,?,1)`,
      [lesson.lastID, ...item, week, deadline, index + 1]
    );
  });

  const liveStart = futureIso(3, 19);
  const liveEnd = new Date(new Date(liveStart).getTime() + 60 * 60 * 1000).toISOString();
  db.run(
    `INSERT INTO live_classes(title,description,starts_at,ends_at,room_url,minimum_percent,status)
     VALUES(?,?,?,?,?,75,'scheduled')`,
    ['Conversation Class — Introductions','Prática de conversação e pronúncia.',liveStart,liveEnd,`https://meet.jit.si/VanguardEnglish-${crypto.randomBytes(4).toString('hex')}`]
  );
  db.run(
    `INSERT INTO notices(title,message,target_student_id,created_by) VALUES(?,?,NULL,?)`,
    ['Bem-vindos à plataforma','Concluam as atividades da semana antes da aula ao vivo.',teacher.lastID]
  );
  const first = db.get('SELECT id FROM activities ORDER BY id LIMIT 1');
  db.run(
    `INSERT INTO submissions(activity_id,student_id,answer_text,score,is_correct,feedback) VALUES(?,?,?,10,1,?)`,
    [first.id, ana.lastID, 'Nice to meet you', 'Muito bem! Resposta correta.']
  );
}

async function initDb() {
  const SQL = await initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
  rawDb = fs.existsSync(DB_FILE) ? new SQL.Database(fs.readFileSync(DB_FILE)) : new SQL.Database();
  db = adapter(rawDb);
  db.exec(fs.readFileSync(path.join(__dirname, 'database.sql'), 'utf8'));
  await seed();
  return db;
}

function getDb() {
  if (!db) throw new Error('Banco ainda não iniciado.');
  return db;
}

module.exports = { initDb, getDb, weekKey, persist };
