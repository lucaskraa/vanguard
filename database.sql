PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK(role IN ('teacher','student')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  access_token TEXT UNIQUE,
  session_token TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL DEFAULT 1,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  video_url TEXT,
  image_url TEXT,
  audio_url TEXT,
  position INTEGER NOT NULL DEFAULT 1,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(unit_id) REFERENCES units(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('multiple_choice','fill_blank','writing','listening','pronunciation')),
  prompt TEXT NOT NULL,
  options_json TEXT,
  correct_answer TEXT,
  explanation TEXT,
  pronunciation_target TEXT,
  media_url TEXT,
  required INTEGER NOT NULL DEFAULT 1,
  points REAL NOT NULL DEFAULT 10,
  week_key TEXT NOT NULL,
  deadline TEXT,
  position INTEGER NOT NULL DEFAULT 1,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  answer_text TEXT,
  transcript TEXT,
  audio_path TEXT,
  score REAL NOT NULL DEFAULT 0,
  is_correct INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 1,
  feedback TEXT,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(activity_id, student_id),
  FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS live_classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  room_url TEXT NOT NULL,
  minimum_percent REAL NOT NULL DEFAULT 75,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','live','finished')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS live_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  live_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  seconds_present INTEGER NOT NULL DEFAULT 0,
  UNIQUE(live_id, student_id),
  FOREIGN KEY(live_id) REFERENCES live_classes(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS live_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  live_id INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  correct_answer TEXT,
  seconds_to_answer INTEGER NOT NULL DEFAULT 30,
  published INTEGER NOT NULL DEFAULT 1,
  revealed INTEGER NOT NULL DEFAULT 0,
  chosen_student_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(live_id) REFERENCES live_classes(id) ON DELETE CASCADE,
  FOREIGN KEY(chosen_student_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS live_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  answer_text TEXT,
  audio_path TEXT,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(question_id, student_id),
  FOREIGN KEY(question_id) REFERENCES live_questions(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  target_student_id INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(target_student_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS absences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('online','live')),
  week_key TEXT NOT NULL,
  live_id INTEGER,
  reason TEXT,
  justified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, kind, week_key),
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(live_id) REFERENCES live_classes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings(key,value) VALUES
  ('school_name','Vanguard English School'),
  ('online_min_percent','70'),
  ('live_min_percent','75'),
  ('content_protection','1');
