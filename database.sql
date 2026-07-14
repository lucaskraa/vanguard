PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK(role IN ('teacher','student')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  avatar TEXT DEFAULT '',
  blocked INTEGER NOT NULL DEFAULT 0,
  access_token TEXT UNIQUE,
  session_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  school_name TEXT NOT NULL DEFAULT 'Vanguard English School',
  course_name TEXT NOT NULL DEFAULT 'English Hybrid',
  weekly_minimum_percent INTEGER NOT NULL DEFAULT 70,
  live_minimum_percent INTEGER NOT NULL DEFAULT 75,
  live_room_url TEXT NOT NULL DEFAULT 'https://meet.jit.si/VanguardEnglishDemoRoom',
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  content_protection INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  written_content TEXT DEFAULT '',
  examples_json TEXT DEFAULT '[]',
  video_url TEXT DEFAULT '',
  audio_url TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(unit_id) REFERENCES units(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER NOT NULL,
  week_label TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('multiple_choice','fill_blank','writing','listening','pronunciation')),
  prompt TEXT NOT NULL,
  options_json TEXT DEFAULT '[]',
  correct_answer TEXT DEFAULT '',
  explanation TEXT DEFAULT '',
  media_url TEXT DEFAULT '',
  required INTEGER NOT NULL DEFAULT 1,
  published INTEGER NOT NULL DEFAULT 1,
  points INTEGER NOT NULL DEFAULT 10,
  due_at TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  answer_text TEXT DEFAULT '',
  audio_url TEXT DEFAULT '',
  transcript TEXT DEFAULT '',
  score REAL NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  feedback TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL,
  student_id INTEGER,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(teacher_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS live_classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  minimum_percent INTEGER NOT NULL DEFAULT 75,
  room_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','live','finished')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS live_presence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  live_class_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  joined_at TEXT,
  last_ping_at TEXT,
  seconds_present INTEGER NOT NULL DEFAULT 0,
  percentage REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','present','absent','justified')),
  UNIQUE(live_class_id, student_id),
  FOREIGN KEY(live_class_id) REFERENCES live_classes(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS live_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  live_class_id INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  correct_answer TEXT DEFAULT '',
  response_type TEXT NOT NULL DEFAULT 'text' CHECK(response_type IN ('text','audio')),
  time_limit_seconds INTEGER NOT NULL DEFAULT 60,
  published INTEGER NOT NULL DEFAULT 0,
  answers_released INTEGER NOT NULL DEFAULT 0,
  selected_student_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(live_class_id) REFERENCES live_classes(id) ON DELETE CASCADE,
  FOREIGN KEY(selected_student_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS live_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  answer_text TEXT DEFAULT '',
  audio_url TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(question_id, student_id),
  FOREIGN KEY(question_id) REFERENCES live_questions(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS absences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('live','online')),
  reference_key TEXT NOT NULL,
  reason TEXT DEFAULT '',
  justified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, kind, reference_key),
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  session_version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lessons_unit ON lessons(unit_id, position);
CREATE INDEX IF NOT EXISTS idx_activities_lesson ON activities(lesson_id, position);
CREATE INDEX IF NOT EXISTS idx_attempts_student ON attempts(student_id, activity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notices_student ON notices(student_id, created_at);
CREATE INDEX IF NOT EXISTS idx_live_presence_class ON live_presence(live_class_id, student_id);
CREATE INDEX IF NOT EXISTS idx_absences_student ON absences(student_id, created_at);
