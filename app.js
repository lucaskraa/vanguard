'use strict';

const VanguardApp = (() => {
  const STORAGE = {
    session: 'vanguard_session_v2',
    demo: 'vanguard_demo_database_v2',
    tab: 'vanguard_active_tab_v2'
  };

  const state = {
    mode: 'checking',
    session: localStorage.getItem(STORAGE.session) || '',
    user: null,
    data: null,
    page: '',
    accessToken: new URLSearchParams(location.search).get('token') || '',
    activeUnitId: null,
    activeLessonId: null,
    activeActivityId: null,
    activeReportStudentId: null,
    mediaRecorder: null,
    audioChunks: [],
    audioBlob: null,
    audioUrl: '',
    transcript: '',
    recognition: null,
    liveTimer: null,
    livePoll: null,
    tabId: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  };

  const elements = {};

  const pageMeta = {
    dashboard: ['Início', 'SEU CURSO'],
    weekly: ['Atividades da semana', 'ROTINA DE ESTUDOS'],
    units: ['Unidades e aulas', 'CONTEÚDO DO CURSO'],
    writing: ['Atividade escrita', 'PRÁTICA DE ESCRITA'],
    pronunciation: ['Atividade de pronúncia', 'PRÁTICA DE FALA'],
    live: ['Aula ao vivo', 'CONVERSAÇÃO'],
    progress: ['Progresso, notas e faltas', 'SEU DESEMPENHO'],
    notices: ['Avisos', 'COMUNICAÇÃO'],
    profile: ['Perfil', 'SUA CONTA'],
    'teacher-dashboard': ['Painel do professor', 'VISÃO GERAL'],
    students: ['Cadastro de alunos', 'GESTÃO DA TURMA'],
    builder: ['Aulas e atividades', 'CONTEÚDO DO CURSO'],
    attendance: ['Presenças e faltas', 'ACOMPANHAMENTO'],
    reports: ['Relatórios dos alunos', 'DESEMPENHO DA TURMA'],
    settings: ['Configurações', 'REGRAS DO CURSO']
  };

  const navigation = {
    student: [
      ['dashboard', '⌂', 'Início'],
      ['weekly', '✓', 'Atividades da semana'],
      ['units', '▤', 'Unidades e aulas'],
      ['writing', '✎', 'Atividade escrita'],
      ['pronunciation', '◉', 'Pronúncia'],
      ['live', '●', 'Aula ao vivo'],
      ['progress', '↗', 'Progresso e faltas'],
      ['notices', '!', 'Avisos'],
      ['profile', '○', 'Perfil']
    ],
    teacher: [
      ['teacher-dashboard', '⌂', 'Painel inicial'],
      ['students', '◎', 'Alunos'],
      ['builder', '＋', 'Aulas e atividades'],
      ['live', '●', 'Aula ao vivo'],
      ['attendance', '✓', 'Presenças e faltas'],
      ['reports', '↗', 'Relatórios'],
      ['notices', '!', 'Avisos'],
      ['settings', '⚙', 'Configurações']
    ]
  };

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function $$(selector, root = document) {
    return [...root.querySelectorAll(selector)];
  }

  function escapeHTML(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  function initials(name = '') {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'VE';
  }

  function formatDate(value, withTime = true) {
    if (!value) return 'Sem data definida';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
    }).format(date);
  }

  function relativeDate(value) {
    if (!value) return '';
    const date = new Date(value);
    const diff = date.getTime() - Date.now();
    const days = Math.ceil(diff / 86400000);
    if (days === 0) return 'Hoje';
    if (days === 1) return 'Amanhã';
    if (days > 1) return `Em ${days} dias`;
    if (days === -1) return 'Ontem';
    return `${Math.abs(days)} dias atrás`;
  }

  function activityTypeLabel(type) {
    return {
      multiple_choice: 'Alternativas',
      fill_blank: 'Completar frase',
      writing: 'Escrita',
      listening: 'Escuta',
      pronunciation: 'Pronúncia'
    }[type] || type;
  }

  function activityIcon(type) {
    return {
      multiple_choice: 'A',
      fill_blank: '…',
      writing: '✎',
      listening: '♫',
      pronunciation: '◉'
    }[type] || '•';
  }

  function statusBadge(text, kind = 'muted') {
    return `<span class="badge badge--${kind}">${escapeHTML(text)}</span>`;
  }

  function getBaseURL() {
    return `${location.origin}${location.pathname.replace(/index\.html$/i, '')}`;
  }

  function studentLink(token) {
    return `${getBaseURL()}?token=${encodeURIComponent(token)}`;
  }

  function toast(title, message = '', type = 'success') {
    const item = document.createElement('article');
    item.className = `toast ${type === 'error' ? 'is-error' : ''}`;
    item.innerHTML = `
      <div class="toast__icon">${type === 'error' ? '!' : '✓'}</div>
      <div><strong>${escapeHTML(title)}</strong><p>${escapeHTML(message)}</p></div>
      <button type="button" aria-label="Fechar">×</button>
    `;
    item.querySelector('button').addEventListener('click', () => item.remove());
    elements.toastRoot.append(item);
    setTimeout(() => item.remove(), 4800);
  }

  function openModal({ title, subtitle = '', body = '', wide = false, footer = '' }) {
    document.body.classList.add('modal-open');
    elements.modalRoot.innerHTML = `
      <section class="modal ${wide ? 'modal--wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}">
        <header class="modal__header">
          <div><h2>${escapeHTML(title)}</h2>${subtitle ? `<p>${escapeHTML(subtitle)}</p>` : ''}</div>
          <button class="modal__close" type="button" data-action="close-modal" aria-label="Fechar">×</button>
        </header>
        <div class="modal__body">${body}</div>
        ${footer ? `<footer class="modal__footer">${footer}</footer>` : ''}
      </section>
    `;
  }

  function closeModal() {
    document.body.classList.remove('modal-open');
    elements.modalRoot.innerHTML = '';
  }

  function loadingPage() {
    elements.content.innerHTML = '<div class="loading-page"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (!(options.body instanceof FormData)) headers.set('content-type', 'application/json');
    if (state.session) headers.set('authorization', `Bearer ${state.session}`);
    const response = await fetch(path, { ...options, headers });
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    if (!response.ok) {
      const error = new Error(payload.error || `Erro ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function demoSeed() {
    const due = new Date(Date.now() + 5 * 86400000);
    due.setHours(23, 0, 0, 0);
    const liveDate = new Date(Date.now() + 3 * 86400000);
    liveDate.setHours(19, 0, 0, 0);
    const created = new Date().toISOString();

    return {
      version: 2,
      settings: {
        id: 1,
        school_name: 'Vanguard English School',
        course_name: 'English Hybrid',
        weekly_minimum_percent: 70,
        live_minimum_percent: 75,
        live_room_url: 'https://meet.jit.si/VanguardEnglishDemoRoom',
        timezone: 'America/Sao_Paulo',
        content_protection: true
      },
      users: [
        { id: 1, role: 'teacher', name: 'Professora Marina', email: 'professor@vanguard.demo', password: 'Professor123', avatar: 'PM', blocked: false },
        { id: 2, role: 'student', name: 'Ana Souza', email: 'ana@vanguard.demo', password: 'Aluno123', avatar: 'AS', blocked: false, access_token: 'ana-vanguard-demo' },
        { id: 3, role: 'student', name: 'Bruno Lima', email: 'bruno@vanguard.demo', password: 'Aluno123', avatar: 'BL', blocked: false, access_token: 'bruno-vanguard-demo' },
        { id: 4, role: 'student', name: 'Camila Rocha', email: 'camila@vanguard.demo', password: 'Aluno123', avatar: 'CR', blocked: false, access_token: 'camila-vanguard-demo' },
        { id: 5, role: 'student', name: 'Diego Martins', email: 'diego@vanguard.demo', password: 'Aluno123', avatar: 'DM', blocked: false, access_token: 'diego-vanguard-demo' }
      ],
      units: [
        {
          id: 1,
          title: 'Unit 1 — Everyday English',
          description: 'Rotina, hábitos e conversas do dia a dia.',
          position: 1,
          published: true,
          lessons: [
            {
              id: 1,
              unit_id: 1,
              title: 'Present Continuous',
              summary: 'Como falar sobre ações que estão acontecendo agora.',
              written_content: 'Usamos am, is ou are + verbo com -ing. Essa estrutura mostra que uma ação está acontecendo agora ou durante um período temporário.',
              examples: ['I am reading now.', 'They are practicing English.', 'He is not sleeping.'],
              video_url: 'https://www.youtube.com/embed/OLx3IrlVf6Y',
              audio_url: '',
              image_url: '',
              position: 1,
              published: true,
              activities: [
                { id: 1, lesson_id: 1, week_label: 'Semana atual', title: 'Escolha a frase correta', type: 'multiple_choice', prompt: 'Qual frase descreve uma ação acontecendo agora?', options: ['I study English every Monday.', 'I am studying English now.', 'I studied English yesterday.'], correct_answer: 'I am studying English now.', explanation: 'Para uma ação acontecendo neste momento, use am/is/are + verbo com -ing.', media_url: '', required: true, points: 10, due_at: due.toISOString(), position: 1 },
                { id: 2, lesson_id: 1, week_label: 'Semana atual', title: 'Complete a frase', type: 'fill_blank', prompt: 'She ___ speaking with the teacher.', options: [], correct_answer: 'is', explanation: 'Com she usamos is: She is speaking.', media_url: '', required: true, points: 10, due_at: due.toISOString(), position: 2 },
                { id: 5, lesson_id: 1, week_label: 'Semana atual', title: 'Pronunciation challenge', type: 'pronunciation', prompt: 'Leia em voz alta: I am practicing English every day.', options: [], correct_answer: 'I am practicing English every day.', explanation: 'Fale com calma e destaque os sons de practicing e every.', media_url: '', required: true, points: 10, due_at: due.toISOString(), position: 5 }
              ]
            },
            {
              id: 2,
              unit_id: 1,
              title: 'Daily Routines',
              summary: 'Vocabulário e frases para descrever sua rotina.',
              written_content: 'Use o Simple Present para hábitos: I wake up at seven. She studies in the afternoon.',
              examples: ['I usually have breakfast at 7.', 'She goes to school by bus.', 'We practice every week.'],
              video_url: '', audio_url: '', image_url: '', position: 2, published: true,
              activities: [
                { id: 3, lesson_id: 2, week_label: 'Semana atual', title: 'Escreva sobre sua rotina', type: 'writing', prompt: 'Escreva uma frase em inglês contando o que você faz pela manhã.', options: [], correct_answer: '', explanation: 'Use o Simple Present e tente incluir um horário.', media_url: '', required: true, points: 10, due_at: due.toISOString(), position: 3 }
              ]
            }
          ]
        },
        {
          id: 2,
          title: 'Unit 2 — Real Conversations',
          description: 'Escuta, respostas rápidas e situações reais.',
          position: 2,
          published: true,
          lessons: [
            {
              id: 3, unit_id: 2, title: 'Listening in Context', summary: 'Treino de escuta com perguntas curtas.', written_content: 'Ouça primeiro sem ler. Depois identifique palavras-chave e responda com uma frase completa.', examples: ['Could you repeat that?', 'What do you mean?', 'I understand now.'], video_url: '', audio_url: '', image_url: '', position: 1, published: true,
              activities: [
                { id: 4, lesson_id: 3, week_label: 'Semana atual', title: 'Listening practice', type: 'listening', prompt: 'Ouça a frase e escreva o que foi dito.', options: [], correct_answer: 'Could you repeat that?', explanation: 'A expressão é usada para pedir que alguém repita o que disse.', media_url: '', required: true, points: 10, due_at: due.toISOString(), position: 4 }
              ]
            }
          ]
        },
        {
          id: 3,
          title: 'Unit 3 — Plans and Experiences',
          description: 'Planos, experiências e comunicação com confiança.',
          position: 3,
          published: true,
          lessons: [
            { id: 4, unit_id: 3, title: 'Talking about Plans', summary: 'Use going to para falar de planos.', written_content: 'Estrutura: subject + be + going to + verb. Exemplo: I am going to study tonight.', examples: ['We are going to travel.', 'Are you going to join the class?', 'She is not going to miss it.'], video_url: '', audio_url: '', image_url: '', position: 1, published: true, activities: [] }
          ]
        }
      ],
      attempts: [
        { id: 1, activity_id: 1, student_id: 2, answer_text: 'I am studying English now.', transcript: '', audio_url: '', score: 10, correct: true, feedback: 'Muito bem!', created_at: created },
        { id: 2, activity_id: 2, student_id: 2, answer_text: 'is', transcript: '', audio_url: '', score: 10, correct: true, feedback: 'Resposta correta.', created_at: created },
        { id: 3, activity_id: 3, student_id: 2, answer_text: 'I have breakfast at seven.', transcript: '', audio_url: '', score: 8, correct: true, feedback: 'Boa frase.', created_at: created },
        { id: 4, activity_id: 1, student_id: 3, answer_text: 'I study English every Monday.', transcript: '', audio_url: '', score: 3, correct: false, feedback: 'Revise o Present Continuous.', created_at: created }
      ],
      notices: [
        { id: 1, teacher_id: 1, student_id: null, title: 'Bem-vindos à nova semana', message: 'As atividades ficam disponíveis até domingo às 23h. Na aula ao vivo vamos praticar conversação.', created_at: created },
        { id: 2, teacher_id: 1, student_id: 2, title: 'Ótimo progresso, Ana!', message: 'Você concluiu as primeiras atividades. Continue praticando a pronúncia.', created_at: created }
      ],
      liveClasses: [
        { id: 1, title: 'Conversation Club — Everyday English', starts_at: liveDate.toISOString(), duration_minutes: 60, minimum_percent: 75, room_url: 'https://meet.jit.si/VanguardEnglishDemoRoom', status: 'scheduled', created_at: created }
      ],
      livePresence: [],
      liveQuestions: [
        { id: 1, live_class_id: 1, prompt: 'What are you doing right now?', correct_answer: 'I am studying English.', response_type: 'text', time_limit_seconds: 60, published: false, answers_released: false, selected_student_id: null, created_at: created }
      ],
      liveAnswers: [],
      absences: [
        { id: 1, student_id: 4, kind: 'online', reference_key: '2026-W28', reason: 'Não concluiu a porcentagem mínima da semana.', justified: false, created_at: created }
      ],
      counters: { user: 6, unit: 4, lesson: 5, activity: 6, attempt: 5, notice: 3, live: 2, question: 2, answer: 1, absence: 2 }
    };
  }

  function getDemoDB() {
    let data;
    try {
      data = JSON.parse(localStorage.getItem(STORAGE.demo));
    } catch {
      data = null;
    }
    if (!data || data.version !== 2) {
      data = demoSeed();
      saveDemoDB(data);
    }
    return data;
  }

  function saveDemoDB(data) {
    localStorage.setItem(STORAGE.demo, JSON.stringify(data));
  }

  function flattenActivities(units) {
    return units.flatMap((unit) => unit.lessons.flatMap((lesson) => lesson.activities.map((activity) => ({
      ...activity,
      lesson_title: lesson.title,
      unit_title: unit.title
    }))));
  }

  function demoStudentDashboard(studentId) {
    const db = getDemoDB();
    const student = db.users.find((user) => user.id === Number(studentId));
    const activities = flattenActivities(db.units).map((activity) => {
      const attempts = db.attempts.filter((attempt) => attempt.activity_id === activity.id && attempt.student_id === Number(studentId));
      return {
        ...activity,
        attempt_count: attempts.length,
        best_score: attempts.length ? Math.max(...attempts.map((attempt) => Number(attempt.score || 0))) : null
      };
    });
    const completed = activities.filter((activity) => activity.attempt_count > 0).length;
    const bestAttempts = activities.map((activity) => db.attempts
      .filter((attempt) => attempt.activity_id === activity.id && attempt.student_id === Number(studentId))
      .sort((a, b) => Number(b.score) - Number(a.score))[0]).filter(Boolean);
    const grade = bestAttempts.length ? Math.round((bestAttempts.reduce((sum, attempt) => sum + Number(attempt.score || 0), 0) / (bestAttempts.length * 10)) * 100) / 10 : 0;
    const absences = db.absences.filter((absence) => absence.student_id === Number(studentId));
    const notices = db.notices.filter((notice) => notice.student_id === null || notice.student_id === Number(studentId)).sort((a, b) => b.id - a.id);
    const attempts = db.attempts.filter((attempt) => attempt.student_id === Number(studentId)).sort((a, b) => b.id - a.id).map((attempt) => {
      const activity = activities.find((item) => item.id === attempt.activity_id);
      return { ...attempt, activity_title: activity?.title || 'Atividade', activity_type: activity?.type || '' };
    });
    return {
      student: { ...student },
      settings: { ...db.settings },
      summary: {
        progress: activities.length ? Math.round((completed / activities.length) * 100) : 0,
        grade,
        absences: absences.filter((absence) => !absence.justified).length,
        completed,
        total: activities.length
      },
      activities,
      units: structuredClone(db.units),
      notices,
      absences,
      liveClass: db.liveClasses.find((live) => live.status !== 'finished') || null,
      attempts
    };
  }

  function demoTeacherDashboard() {
    const db = getDemoDB();
    const students = db.users.filter((user) => user.role === 'student').map(({ password, ...student }) => ({ ...student }));
    const activities = flattenActivities(db.units);
    const reports = students.map((student) => {
      const dashboard = demoStudentDashboard(student.id);
      return { ...student, ...dashboard.summary };
    });
    return {
      settings: { ...db.settings },
      summary: {
        students: students.length,
        activeStudents: students.filter((student) => !student.blocked).length,
        units: db.units.length,
        activities: activities.length,
        pending: reports.filter((report) => report.progress < db.settings.weekly_minimum_percent).length
      },
      students,
      units: structuredClone(db.units),
      notices: db.notices.slice().sort((a, b) => b.id - a.id).map((notice) => ({ ...notice, student_name: students.find((student) => student.id === notice.student_id)?.name || null })),
      liveClasses: db.liveClasses.slice().sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at)),
      absences: db.absences.slice().sort((a, b) => b.id - a.id).map((absence) => ({ ...absence, student_name: students.find((student) => student.id === absence.student_id)?.name, student_email: students.find((student) => student.id === absence.student_id)?.email })),
      attempts: db.attempts.slice().sort((a, b) => b.id - a.id).map((attempt) => ({
        ...attempt,
        student_name: students.find((student) => student.id === attempt.student_id)?.name,
        activity_title: activities.find((activity) => activity.id === attempt.activity_id)?.title,
        activity_type: activities.find((activity) => activity.id === attempt.activity_id)?.type
      })),
      reports
    };
  }

  async function checkEnvironment() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);
    try {
      const response = await fetch('./api/health', { signal: controller.signal, cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error('Servidor indisponível');
      state.mode = 'server';
      setEnvironmentBadge('online', 'Servidor Node.js conectado');
    } catch {
      state.mode = 'demo';
      setEnvironmentBadge('demo', 'Demonstração no GitHub Pages');
    } finally {
      clearTimeout(timeout);
    }
  }

  function setEnvironmentBadge(kind, text) {
    elements.environmentBadge.className = `environment-badge is-${kind}`;
    elements.environmentBadge.querySelector('b').textContent = text;
  }

  async function validateAccessToken() {
    if (!state.accessToken) {
      configureTeacherLogin();
      return;
    }
    try {
      let student;
      if (state.mode === 'server') {
        const payload = await api(`/api/access/${encodeURIComponent(state.accessToken)}`);
        student = payload.student;
      } else {
        const db = getDemoDB();
        student = db.users.find((user) => user.role === 'student' && user.access_token === state.accessToken && !user.blocked);
        if (!student) throw new Error('Link individual inválido ou bloqueado.');
      }
      configureStudentLogin(student);
    } catch (error) {
      configureStudentLogin(null, error.message);
    }
  }

  function configureTeacherLogin() {
    elements.loginEyebrow.textContent = 'ÁREA DO PROFESSOR';
    elements.loginTitle.textContent = 'Bem-vindo de volta';
    elements.loginCopy.textContent = 'Entre para administrar alunos, aulas, atividades e relatórios.';
    elements.demoLabel.textContent = 'Conta do professor';
    elements.demoCredentials.textContent = 'professor@vanguard.demo · Professor123';
    elements.studentLinkNote.textContent = 'O aluno entra pelo link individual gerado no painel do professor.';
    elements.loginEmail.value = '';
    elements.loginEmail.readOnly = false;
  }

  function configureStudentLogin(student, error = '') {
    elements.loginEyebrow.textContent = 'ACESSO INDIVIDUAL DO ALUNO';
    elements.loginTitle.textContent = student ? `Olá, ${student.name.split(' ')[0]}` : 'Link não encontrado';
    elements.loginCopy.textContent = student ? 'Confirme sua senha para acessar suas atividades e a aula ao vivo.' : error;
    elements.demoLabel.textContent = 'Conta de demonstração do aluno';
    elements.demoCredentials.textContent = 'ana@vanguard.demo · Aluno123';
    elements.studentLinkNote.textContent = 'Este link funciona apenas com o e-mail cadastrado pelo professor.';
    elements.loginEmail.value = student?.email || '';
    elements.loginEmail.readOnly = Boolean(student);
  }

  async function restoreSession() {
    if (!state.session) return false;
    try {
      if (state.mode === 'server') {
        const payload = await api('/api/me');
        state.user = payload.user;
      } else {
        const saved = JSON.parse(state.session);
        const db = getDemoDB();
        const user = db.users.find((item) => item.id === saved.userId && !item.blocked);
        if (!user) throw new Error('Sessão inválida');
        if (user.role === 'student' && saved.accessToken !== user.access_token) throw new Error('Link alterado');
        state.user = { ...user };
      }
      await loadDashboard();
      showPlatform();
      return true;
    } catch {
      clearSession();
      return false;
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    const email = elements.loginEmail.value.trim().toLowerCase();
    const password = elements.loginPassword.value;
    elements.loginFeedback.textContent = '';
    const button = elements.loginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    button.querySelector('span:first-child').textContent = 'Entrando...';
    try {
      if (state.mode === 'server') {
        const payload = await api('/api/login', {
          method: 'POST',
          body: JSON.stringify({ email, password, accessToken: state.accessToken })
        });
        state.session = payload.session;
        state.user = payload.user;
        localStorage.setItem(STORAGE.session, state.session);
      } else {
        const db = getDemoDB();
        const user = db.users.find((item) => item.email.toLowerCase() === email);
        if (!user || user.password !== password) throw new Error('E-mail ou senha incorretos.');
        if (user.blocked) throw new Error('Este acesso foi bloqueado pelo professor.');
        if (user.role === 'student' && (!state.accessToken || user.access_token !== state.accessToken)) {
          throw new Error('O aluno precisa entrar pelo link individual enviado pelo professor.');
        }
        if (user.role === 'teacher' && state.accessToken) throw new Error('Este é um link individual de aluno.');
        state.user = { ...user };
        state.session = JSON.stringify({ userId: user.id, accessToken: user.access_token || '', tabId: state.tabId, createdAt: Date.now() });
        localStorage.setItem(STORAGE.session, state.session);
        enforceDemoSingleSession();
      }
      await loadDashboard();
      showPlatform();
      toast('Acesso liberado', `Bem-vindo, ${state.user.name.split(' ')[0]}!`);
    } catch (error) {
      elements.loginFeedback.textContent = error.message;
    } finally {
      button.disabled = false;
      button.querySelector('span:first-child').textContent = 'Entrar na plataforma';
    }
  }

  function enforceDemoSingleSession() {
    if (state.mode !== 'demo' || !state.user) return;
    localStorage.setItem(STORAGE.tab, JSON.stringify({ userId: state.user.id, tabId: state.tabId, at: Date.now() }));
  }

  function setupSessionWatcher() {
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE.tab && state.mode === 'demo' && state.user) {
        try {
          const active = JSON.parse(event.newValue);
          if (active.userId === state.user.id && active.tabId !== state.tabId) {
            clearSession();
            showLogin();
            toast('Sessão encerrada', 'A conta foi acessada em outra aba ou dispositivo.', 'error');
          }
        } catch {
          // Ignora dados inválidos.
        }
      }
    });
  }

  async function loadDashboard() {
    if (!state.user) return;
    if (state.mode === 'server') {
      state.data = state.user.role === 'teacher'
        ? await api('/api/teacher/dashboard')
        : await api('/api/student/dashboard');
    } else {
      state.data = state.user.role === 'teacher'
        ? demoTeacherDashboard()
        : demoStudentDashboard(state.user.id);
    }
  }

  function clearSession() {
    state.session = '';
    state.user = null;
    state.data = null;
    state.page = '';
    localStorage.removeItem(STORAGE.session);
    stopLiveTimers();
  }

  async function logout() {
    try {
      if (state.mode === 'server' && state.session) await api('/api/logout', { method: 'POST', body: '{}' });
    } catch {
      // A sessão pode já ter expirado.
    }
    clearSession();
    showLogin();
  }

  function showLogin() {
    document.body.classList.remove('has-watermark', 'protected-content', 'sidebar-open');
    elements.platformView.classList.add('is-hidden');
    elements.loginView.classList.remove('is-hidden');
    elements.loginPassword.value = '';
    elements.loginFeedback.textContent = '';
    validateAccessToken();
  }

  function showPlatform() {
    elements.loginView.classList.add('is-hidden');
    elements.platformView.classList.remove('is-hidden');
    renderShell();
    const defaultPage = state.user.role === 'teacher' ? 'teacher-dashboard' : 'dashboard';
    navigate(defaultPage);
  }

  function renderShell() {
    const navItems = navigation[state.user.role];
    elements.mainNav.innerHTML = navItems.map(([page, icon, label]) => `
      <button class="nav-button" type="button" data-page="${page}">
        <span class="nav-icon">${icon}</span><span>${escapeHTML(label)}</span>
      </button>
    `).join('');
    elements.sidebarUser.innerHTML = `
      <span class="avatar">${escapeHTML(state.user.avatar || initials(state.user.name))}</span>
      <div><strong>${escapeHTML(state.user.name)}</strong><span>${state.user.role === 'teacher' ? 'Professor' : 'Aluno'}</span></div>
    `;
    elements.topbarUser.innerHTML = `
      <span class="avatar">${escapeHTML(state.user.avatar || initials(state.user.name))}</span>
      <div><strong>${escapeHTML(state.user.name)}</strong><span>${state.user.role === 'teacher' ? 'Professor' : 'Aluno'}</span></div>
    `;
    const noticeCount = state.user.role === 'teacher'
      ? state.data.notices?.length || 0
      : state.data.notices?.length || 0;
    elements.noticeCount.textContent = String(Math.min(99, noticeCount));
    applyProtection();
  }

  function applyProtection() {
    const enabled = state.user?.role === 'student' && state.data?.settings?.content_protection;
    document.body.classList.toggle('has-watermark', Boolean(enabled));
    document.body.classList.toggle('protected-content', Boolean(enabled));
    if (enabled) {
      const text = `${state.user.name} • ${state.user.email}`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="370" height="170"><text x="10" y="90" fill="#173c2a" font-size="15" font-family="Arial">${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</text></svg>`;
      elements.watermark.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    } else {
      elements.watermark.style.backgroundImage = '';
    }
  }

  function navigate(page, options = {}) {
    if (!state.user) return;
    if (!navigation[state.user.role].some(([itemPage]) => itemPage === page)) {
      page = state.user.role === 'teacher' ? 'teacher-dashboard' : 'dashboard';
    }
    state.page = page;
    if (options.unitId) state.activeUnitId = Number(options.unitId);
    if (options.lessonId) state.activeLessonId = Number(options.lessonId);
    if (options.activityId) state.activeActivityId = Number(options.activityId);
    if (options.studentId) state.activeReportStudentId = Number(options.studentId);
    stopLiveTimers();
    $$('.nav-button', elements.mainNav).forEach((button) => button.classList.toggle('is-active', button.dataset.page === page));
    const [title, kicker] = pageMeta[page] || ['Vanguard', 'ENGLISH SCHOOL'];
    elements.pageTitle.textContent = title;
    elements.pageKicker.textContent = kicker;
    document.body.classList.remove('sidebar-open');
    renderPage();
    elements.content.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderPage() {
    const renderers = {
      dashboard: renderStudentDashboard,
      weekly: renderWeeklyActivities,
      units: renderUnits,
      writing: () => renderActivityPage('writing'),
      pronunciation: () => renderActivityPage('pronunciation'),
      live: renderLiveClass,
      progress: renderProgress,
      notices: renderNotices,
      profile: renderProfile,
      'teacher-dashboard': renderTeacherDashboard,
      students: renderStudents,
      builder: renderBuilder,
      attendance: renderAttendance,
      reports: renderReports,
      settings: renderSettings
    };
    loadingPage();
    requestAnimationFrame(() => renderers[state.page]?.());
  }

  function pageHeader({ eyebrow, title, description, actions = '' }) {
    return `
      <header class="page-header">
        <div class="page-header__copy">
          <span class="overline overline--green">${escapeHTML(eyebrow)}</span>
          <h1>${escapeHTML(title)}</h1>
          <p>${escapeHTML(description)}</p>
        </div>
        ${actions ? `<div class="page-actions">${actions}</div>` : ''}
      </header>
    `;
  }

  function renderStudentDashboard() {
    const { student, summary, activities, notices, liveClass } = state.data;
    const pending = activities.filter((activity) => !activity.attempt_count).slice(0, 4);
    elements.content.innerHTML = `
      <section class="student-hero">
        <div class="student-hero__copy">
          <span class="overline">SUA SEMANA NA VANGUARD</span>
          <h1>Hello, ${escapeHTML(student.name.split(' ')[0])}.</h1>
          <p>Continue de onde parou. Você tem ${pending.length} ${pending.length === 1 ? 'atividade pendente' : 'atividades pendentes'} e uma aula ao vivo para praticar com a turma.</p>
        </div>
        <div class="student-hero__side">
          <div class="progress-ring" style="--value:${summary.progress}"><strong>${summary.progress}%</strong></div>
          <div class="hero-metric"><small>Progresso geral</small><strong>${summary.completed} de ${summary.total} atividades</strong></div>
        </div>
      </section>

      <div class="stats-grid">
        ${statCard('Atividades da semana', `${summary.completed}/${summary.total}`, 'concluídas')}
        ${statCard('Próxima aula', liveClass ? relativeDate(liveClass.starts_at) : '—', liveClass ? formatDate(liveClass.starts_at) : 'Sem aula marcada', true)}
        ${statCard('Progresso', `${summary.progress}%`, 'do curso')}
        ${statCard('Nota média', `${summary.grade}`, 'de 10')}
        ${statCard('Faltas', `${summary.absences}`, summary.absences ? 'requer atenção' : 'nenhuma pendência', summary.absences > 0)}
      </div>

      <div class="dashboard-grid">
        <section class="card card--pad">
          <div class="card-header"><div><h3>Atividades da semana</h3><p>Conclua o conjunto obrigatório até o prazo.</p></div><button class="btn btn--quiet" data-page="weekly">Ver todas</button></div>
          <div class="list">
            ${pending.length ? pending.map(activityListItem).join('') : emptyState('✓', 'Semana concluída', 'Você terminou todas as atividades obrigatórias desta semana.')}
          </div>
        </section>

        <aside class="grid">
          ${liveClass ? `
            <section class="card card--dark card--pad">
              <div class="card-header"><div><h3>Próxima aula ao vivo</h3><p style="color:rgba(255,255,255,.58)">${formatDate(liveClass.starts_at)}</p></div>${statusBadge(liveClass.status === 'live' ? 'Ao vivo' : 'Agendada', liveClass.status === 'live' ? 'danger' : 'orange')}</div>
              <h4 style="margin:0 0 18px;font-family:Georgia,serif;font-size:1.35rem;font-weight:500">${escapeHTML(liveClass.title)}</h4>
              <button class="btn btn--orange" data-page="live">Abrir sala</button>
            </section>
          ` : ''}
          <section class="card card--pad">
            <div class="card-header"><div><h3>Aviso recente</h3><p>Mensagem do professor</p></div><button class="btn btn--quiet" data-page="notices">Todos</button></div>
            ${notices[0] ? `<strong>${escapeHTML(notices[0].title)}</strong><p style="margin:8px 0 0;color:var(--muted);font-size:.8rem;line-height:1.55">${escapeHTML(notices[0].message)}</p>` : '<p class="muted">Nenhum aviso.</p>'}
          </section>
        </aside>
      </div>
    `;
  }

  function statCard(label, value, caption, orange = false) {
    return `<article class="stat-card ${orange ? 'stat-card--orange' : ''}"><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong><span>${escapeHTML(caption)}</span></article>`;
  }

  function activityListItem(activity) {
    const completed = Number(activity.attempt_count || 0) > 0;
    return `
      <article class="list-item">
        <div class="list-item__main">
          <span class="list-item__icon">${activityIcon(activity.type)}</span>
          <div class="list-item__copy"><strong>${escapeHTML(activity.title)}</strong><span>${escapeHTML(activity.lesson_title)} · ${formatDate(activity.due_at)}</span></div>
        </div>
        <div class="list-item__side">
          ${completed ? statusBadge('Entregue', 'success') : statusBadge('Pendente', 'warning')}
          <button class="btn btn--quiet" data-open-activity="${activity.id}">${completed ? 'Refazer' : 'Começar'}</button>
        </div>
      </article>
    `;
  }

  function emptyState(icon, title, message) {
    return `<div class="empty-state"><div><span class="empty-state__icon">${icon}</span><h3>${escapeHTML(title)}</h3><p>${escapeHTML(message)}</p></div></div>`;
  }

  function renderWeeklyActivities() {
    const activities = state.data.activities;
    const completed = activities.filter((activity) => activity.attempt_count > 0).length;
    const percent = activities.length ? Math.round((completed / activities.length) * 100) : 0;
    const minimum = state.data.settings.weekly_minimum_percent;
    elements.content.innerHTML = `
      ${pageHeader({
        eyebrow: 'PRESENÇA ONLINE SEMANAL',
        title: 'Sua semana de estudos',
        description: `Conclua pelo menos ${minimum}% das atividades obrigatórias até o prazo. A falta online é registrada uma única vez pelo conjunto da semana.`
      })}
      <section class="card card--pad" style="margin-bottom:20px">
        <div class="card-header"><div><h3>Progresso desta semana</h3><p>${completed} de ${activities.length} atividades entregues</p></div>${statusBadge(percent >= minimum ? 'Presença garantida' : `Mínimo: ${minimum}%`, percent >= minimum ? 'success' : 'warning')}</div>
        <div class="progress-bar"><span style="width:${percent}%"></span></div>
        <p style="margin:10px 0 0;color:var(--muted);font-size:.77rem">Você concluiu ${percent}%.</p>
      </section>
      <div class="activity-grid">${activities.map(activityCard).join('')}</div>
    `;
  }

  function activityCard(activity) {
    const completed = Number(activity.attempt_count || 0) > 0;
    return `
      <article class="activity-card">
        <div class="activity-card__top">
          <div class="list-item__main"><span class="type-icon">${activityIcon(activity.type)}</span><div><span class="badge">${activityTypeLabel(activity.type)}</span><h3>${escapeHTML(activity.title)}</h3><p>${escapeHTML(activity.unit_title)} · ${escapeHTML(activity.lesson_title)}</p></div></div>
          ${completed ? statusBadge('Entregue', 'success') : statusBadge('Pendente', 'warning')}
        </div>
        <p>${escapeHTML(activity.prompt)}</p>
        <div class="activity-meta"><span>Prazo: ${formatDate(activity.due_at)}</span><span>•</span><span>${activity.points} pontos</span><span>•</span><span>${activity.required ? 'Obrigatória' : 'Opcional'}</span></div>
        <footer class="activity-card__footer"><span class="muted">${completed ? `Melhor nota: ${activity.best_score ?? 0}` : 'Ainda não iniciada'}</span><button class="btn btn--primary" data-open-activity="${activity.id}">${completed ? 'Refazer' : 'Responder'}</button></footer>
      </article>
    `;
  }

  function renderUnits() {
    const units = state.data.units;
    if (state.activeLessonId) {
      const found = findLesson(state.activeLessonId);
      if (found) return renderLesson(found.unit, found.lesson);
    }
    elements.content.innerHTML = `
      ${pageHeader({ eyebrow: 'CONTEÚDO ORGANIZADO', title: 'Unidades do curso', description: 'Cada unidade reúne explicações, exemplos, videoaulas, áudios e atividades práticas.' })}
      <div class="unit-grid">
        ${units.map((unit, index) => `
          <article class="unit-card">
            <span class="unit-card__number">UNIT ${String(index + 1).padStart(2, '0')}</span>
            <h3>${escapeHTML(unit.title)}</h3>
            <p>${escapeHTML(unit.description)}</p>
            <footer class="unit-card__footer"><span>${unit.lessons.length} ${unit.lessons.length === 1 ? 'aula' : 'aulas'}</span><button class="btn btn--quiet" data-open-unit="${unit.id}">Abrir unidade</button></footer>
          </article>
        `).join('')}
      </div>
      ${state.activeUnitId ? renderUnitLessons(state.activeUnitId) : ''}
    `;
  }

  function renderUnitLessons(unitId) {
    const unit = state.data.units.find((item) => item.id === Number(unitId));
    if (!unit) return '';
    return `
      <section class="section" id="unit-lessons">
        <div class="section-heading"><div><h3>${escapeHTML(unit.title)}</h3><p>${escapeHTML(unit.description)}</p></div></div>
        <div class="list">
          ${unit.lessons.map((lesson, index) => `
            <article class="list-item">
              <div class="list-item__main"><span class="list-item__icon">${index + 1}</span><div class="list-item__copy"><strong>${escapeHTML(lesson.title)}</strong><span>${escapeHTML(lesson.summary)}</span></div></div>
              <div class="list-item__side">${statusBadge(`${lesson.activities.length} atividades`, 'muted')}<button class="btn btn--primary" data-open-lesson="${lesson.id}">Estudar</button></div>
            </article>
          `).join('') || emptyState('▤', 'Unidade sem aulas', 'O professor ainda não publicou aulas nesta unidade.')}
        </div>
      </section>
    `;
  }

  function findLesson(lessonId) {
    for (const unit of state.data.units) {
      const lesson = unit.lessons.find((item) => item.id === Number(lessonId));
      if (lesson) return { unit, lesson };
    }
    return null;
  }

  function findActivity(activityId) {
    for (const unit of state.data.units) {
      for (const lesson of unit.lessons) {
        const activity = lesson.activities.find((item) => item.id === Number(activityId));
        if (activity) return { unit, lesson, activity };
      }
    }
    return null;
  }

  function renderLesson(unit, lesson) {
    elements.content.innerHTML = `
      ${pageHeader({
        eyebrow: unit.title,
        title: lesson.title,
        description: lesson.summary,
        actions: '<button class="btn btn--outline" data-back-units>← Voltar às unidades</button>'
      })}
      <div class="lesson-layout">
        <div class="lesson-main">
          ${lesson.video_url ? `<div class="media-frame"><iframe src="${escapeHTML(lesson.video_url)}" title="Videoaula: ${escapeHTML(lesson.title)}" allowfullscreen loading="lazy"></iframe></div>` : ''}
          <article class="prose">
            <h2>Explicação</h2>
            <p>${escapeHTML(lesson.written_content)}</p>
            ${lesson.examples?.length ? `<h3>Exemplos</h3><div class="example-list">${lesson.examples.map((example) => `<div class="example-item">${escapeHTML(example)}</div>`).join('')}</div>` : ''}
          </article>
          <section class="card card--pad">
            <div class="card-header"><div><h3>Atividades desta aula</h3><p>Pratique o conteúdo antes de avançar.</p></div></div>
            <div class="list">${lesson.activities.map((activity) => `
              <article class="list-item">
                <div class="list-item__main"><span class="list-item__icon">${activityIcon(activity.type)}</span><div class="list-item__copy"><strong>${escapeHTML(activity.title)}</strong><span>${activityTypeLabel(activity.type)} · ${activity.points} pontos</span></div></div>
                <button class="btn btn--primary" data-open-activity="${activity.id}">Responder</button>
              </article>
            `).join('') || emptyState('✓', 'Sem atividades', 'Esta aula ainda não possui atividades.')}</div>
          </section>
        </div>
        <aside class="lesson-sidebar">
          <section class="card card--pad">
            <div class="card-header"><div><h4>Aulas da unidade</h4><p>Continue na sequência.</p></div></div>
            <div class="list">${unit.lessons.map((item, index) => `<button class="lesson-nav-button ${item.id === lesson.id ? 'is-active' : ''}" data-open-lesson="${item.id}"><span class="list-item__icon">${index + 1}</span><span><strong>${escapeHTML(item.title)}</strong><small>${item.activities.length} atividades</small></span></button>`).join('')}</div>
          </section>
          <section class="card card--accent card--pad"><div class="card-header"><div><h4>Dica de estudo</h4></div></div><p style="margin:0;color:var(--muted);font-size:.8rem;line-height:1.6">Assista ao vídeo, leia os exemplos em voz alta e depois faça as atividades sem consultar a explicação.</p></section>
        </aside>
      </div>
    `;
  }

  function renderActivityPage(preferredType = '') {
    let found = state.activeActivityId ? findActivity(state.activeActivityId) : null;
    if (!found) {
      const activity = state.data.activities.find((item) => item.type === preferredType) || state.data.activities[0];
      found = activity ? findActivity(activity.id) : null;
    }
    if (!found) {
      elements.content.innerHTML = emptyState('✎', 'Atividade indisponível', 'O professor ainda não publicou uma atividade deste tipo.');
      return;
    }
    state.activeActivityId = found.activity.id;
    const { activity, lesson, unit } = found;
    const input = renderActivityInput(activity);
    elements.content.innerHTML = `
      <div class="exercise-shell">
        <article class="exercise-card">
          <div class="exercise-top">
            <div><span class="badge">${activityTypeLabel(activity.type)}</span><h1>${escapeHTML(activity.title)}</h1></div>
            ${statusBadge(`${activity.points} pontos`, 'orange')}
          </div>
          <div class="activity-meta"><span>${escapeHTML(unit.title)}</span><span>•</span><span>${escapeHTML(lesson.title)}</span><span>•</span><span>Prazo: ${formatDate(activity.due_at)}</span></div>
          <div class="prompt-box">${escapeHTML(activity.prompt)}</div>
          <form id="activity-form" data-activity-id="${activity.id}" data-activity-type="${activity.type}">
            ${input}
            <div id="activity-result"></div>
            <div class="exercise-actions"><button class="btn btn--outline" type="button" data-page="weekly">Voltar</button><button class="btn btn--primary btn--large" type="submit">Enviar resposta <span>→</span></button></div>
          </form>
        </article>
      </div>
    `;
    if (activity.type === 'pronunciation') setupPronunciationControls();
  }

  function renderActivityInput(activity) {
    if (activity.type === 'multiple_choice') {
      return `<div class="option-list">${activity.options.map((option) => `<button class="option-button" type="button" data-select-option="${escapeHTML(option)}">${escapeHTML(option)}</button>`).join('')}</div><input id="activity-answer" type="hidden">`;
    }
    if (activity.type === 'fill_blank') {
      return `<label class="field"><span>Sua resposta</span><input id="activity-answer" type="text" autocomplete="off" placeholder="Complete a frase" required></label>`;
    }
    if (activity.type === 'writing') {
      return `<label class="field"><span>Escreva em inglês</span><textarea id="activity-answer" placeholder="Digite sua resposta com uma frase completa..." required></textarea></label>`;
    }
    if (activity.type === 'listening') {
      return `<div class="card card--flat card--pad" style="margin-bottom:16px"><button class="btn btn--orange" type="button" data-speak="${escapeHTML(activity.correct_answer)}">♫ Ouvir a frase</button><p class="muted" style="font-size:.76rem;margin:12px 0 0">Você pode ouvir novamente antes de responder.</p></div><label class="field"><span>O que você ouviu?</span><input id="activity-answer" type="text" autocomplete="off" placeholder="Escreva a frase em inglês" required></label>`;
    }
    return `
      <div class="pronunciation-panel">
        <button id="mic-button" class="mic-button" type="button" aria-label="Começar gravação"></button>
        <div><strong id="mic-title">Toque no microfone para começar</strong><p id="mic-copy" class="muted" style="margin:6px 0 0;font-size:.8rem">Leia a frase em voz alta. O áudio ficará disponível para o professor.</p></div>
        <div id="transcript-box" class="transcript-box">A transcrição aparecerá aqui.</div>
        <audio id="audio-preview" class="is-hidden" controls></audio>
      </div>
      <input id="activity-answer" type="hidden">
    `;
  }

  function normalizeAnswer(value) {
    return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function answerSimilarity(expected, actual) {
    const a = normalizeAnswer(expected);
    const b = normalizeAnswer(actual);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const words = a.split(' ');
    const actualWords = new Set(b.split(' '));
    return words.filter((word) => actualWords.has(word)).length / words.length;
  }

  async function submitActivity(form) {
    const activityId = Number(form.dataset.activityId);
    const type = form.dataset.activityType;
    const found = findActivity(activityId);
    if (!found) return;
    const answerText = $('#activity-answer')?.value?.trim() || '';
    if (!answerText && type !== 'pronunciation') {
      toast('Preencha sua resposta', 'Escreva ou escolha uma opção antes de enviar.', 'error');
      return;
    }
    if (type === 'pronunciation' && !state.transcript && !state.audioBlob) {
      toast('Grave sua pronúncia', 'Use o microfone antes de enviar.', 'error');
      return;
    }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Enviando...';
    try {
      let audioUrl = state.audioUrl;
      if (state.mode === 'server' && state.audioBlob && !audioUrl) audioUrl = await uploadBlob(state.audioBlob, 'pronuncia.webm');
      let result;
      if (state.mode === 'server') {
        result = await api('/api/student/attempts', {
          method: 'POST',
          body: JSON.stringify({ activityId, answerText, transcript: state.transcript, audioUrl })
        });
        state.data = result.dashboard;
      } else {
        result = demoSubmitAttempt(found.activity, answerText, state.transcript, audioUrl);
        state.data = demoStudentDashboard(state.user.id);
      }
      const attempt = result.attempt;
      $('#activity-result').innerHTML = `<div class="exercise-result ${attempt.correct ? '' : 'is-error'}"><strong>${attempt.correct ? 'Muito bem!' : 'Vamos revisar'}</strong><p>${escapeHTML(attempt.feedback)}</p>${attempt.expected ? `<p><b>Resposta esperada:</b> ${escapeHTML(attempt.expected)}</p>` : ''}<p><b>Nota:</b> ${attempt.score}</p></div>`;
      renderShell();
      toast('Resposta registrada', attempt.correct ? 'Atividade corrigida com sucesso.' : 'Leia a explicação e tente novamente.');
    } catch (error) {
      toast('Não foi possível enviar', error.message, 'error');
    } finally {
      submit.disabled = false;
      submit.innerHTML = 'Enviar resposta <span>→</span>';
    }
  }

  function demoSubmitAttempt(activity, answerText, transcript, audioUrl) {
    const db = getDemoDB();
    const response = transcript || answerText;
    let score = 0;
    let correct = false;
    let feedback = activity.explanation || 'Resposta registrada.';
    if (activity.type === 'writing' && !activity.correct_answer) {
      score = clamp(Math.round(response.split(/\s+/).filter(Boolean).length / 2), 4, 10);
      correct = response.length >= 8;
      feedback = correct ? 'Resposta enviada. O professor poderá revisar sua escrita.' : 'Escreva uma frase mais completa.';
    } else if (activity.type === 'pronunciation') {
      const match = answerSimilarity(activity.correct_answer, response);
      score = Math.round(match * 100) / 10;
      correct = match >= .7;
      feedback = correct ? 'Boa pronúncia! A frase reconhecida ficou próxima do modelo.' : activity.explanation;
    } else {
      const match = answerSimilarity(activity.correct_answer, response);
      correct = match >= .92;
      score = correct ? Number(activity.points || 10) : Math.round(match * Number(activity.points || 10) * 10) / 10;
      feedback = correct ? 'Resposta correta!' : activity.explanation;
    }
    const attempt = { id: db.counters.attempt++, activity_id: activity.id, student_id: state.user.id, answer_text: answerText, transcript, audio_url: audioUrl || '', score, correct, feedback, created_at: new Date().toISOString() };
    db.attempts.push(attempt);
    saveDemoDB(db);
    return { attempt: { ...attempt, expected: correct ? undefined : activity.correct_answer } };
  }

  async function uploadBlob(blob, filename) {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Falha ao ler o áudio.'));
      reader.readAsDataURL(blob);
    });
    const payload = await api('/api/upload', {
      method: 'POST',
      body: JSON.stringify({ name: filename, type: blob.type || 'audio/webm', data })
    });
    return payload.file.url;
  }

  function setupPronunciationControls() {
    state.audioBlob = null;
    state.audioUrl = '';
    state.transcript = '';
    $('#mic-button')?.addEventListener('click', toggleRecording);
  }

  async function toggleRecording() {
    if (state.mediaRecorder?.state === 'recording') {
      state.mediaRecorder.stop();
      state.recognition?.stop?.();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      toast('Microfone indisponível', 'Use Chrome ou Edge em HTTPS ou localhost.', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.audioChunks = [];
      state.mediaRecorder = new MediaRecorder(stream);
      state.mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data.size) state.audioChunks.push(event.data);
      });
      state.mediaRecorder.addEventListener('stop', () => {
        state.audioBlob = new Blob(state.audioChunks, { type: state.mediaRecorder.mimeType || 'audio/webm' });
        const preview = $('#audio-preview');
        preview.src = URL.createObjectURL(state.audioBlob);
        preview.classList.remove('is-hidden');
        $('#mic-button').classList.remove('is-recording');
        $('#mic-title').textContent = 'Gravação concluída';
        $('#mic-copy').textContent = 'Ouça o áudio ou grave novamente antes de enviar.';
        stream.getTracks().forEach((track) => track.stop());
        $('#activity-answer').value = state.transcript;
      });
      setupSpeechRecognition();
      state.mediaRecorder.start();
      state.recognition?.start?.();
      $('#mic-button').classList.add('is-recording');
      $('#mic-title').textContent = 'Gravando... toque para parar';
      $('#mic-copy').textContent = 'Leia a frase com naturalidade.';
    } catch (error) {
      toast('Permissão do microfone negada', error.message, 'error');
    }
  }

  function setupSpeechRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      state.recognition = null;
      $('#transcript-box').textContent = 'Seu navegador gravará o áudio, mas não oferece transcrição automática.';
      return;
    }
    state.recognition = new Recognition();
    state.recognition.lang = 'en-US';
    state.recognition.continuous = true;
    state.recognition.interimResults = true;
    state.recognition.onresult = (event) => {
      let text = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) text += event.results[index][0].transcript;
      state.transcript = text.trim();
      $('#transcript-box').textContent = state.transcript || 'Ouvindo...';
      $('#activity-answer').value = state.transcript;
    };
  }

  function renderProgress() {
    const { summary, attempts, absences } = state.data;
    elements.content.innerHTML = `
      ${pageHeader({ eyebrow: 'ACOMPANHAMENTO INDIVIDUAL', title: 'Seu desempenho', description: 'Veja seu progresso, suas notas, tentativas e o histórico de faltas.' })}
      <div class="stats-grid">
        ${statCard('Progresso geral', `${summary.progress}%`, `${summary.completed}/${summary.total} atividades`)}
        ${statCard('Nota média', `${summary.grade}`, 'de 10')}
        ${statCard('Concluídas', `${summary.completed}`, 'atividades')}
        ${statCard('Pendentes', `${Math.max(0, summary.total - summary.completed)}`, 'atividades')}
        ${statCard('Faltas', `${summary.absences}`, 'não justificadas', summary.absences > 0)}
      </div>
      <div class="grid grid--2">
        <section class="card card--pad">
          <div class="card-header"><div><h3>Últimas tentativas</h3><p>Resultados enviados pela plataforma.</p></div></div>
          <div class="list">${attempts.length ? attempts.slice(0, 10).map((attempt) => `
            <article class="list-item"><div class="list-item__main"><span class="list-item__icon">${attempt.correct ? '✓' : '!'}</span><div class="list-item__copy"><strong>${escapeHTML(attempt.activity_title)}</strong><span>${formatDate(attempt.created_at)} · ${escapeHTML(attempt.feedback)}</span></div></div><div class="list-item__side">${statusBadge(`Nota ${attempt.score}`, attempt.correct ? 'success' : 'warning')}</div></article>
          `).join('') : emptyState('↗', 'Nenhuma tentativa', 'Faça uma atividade para acompanhar suas notas.')}</div>
        </section>
        <section class="card card--pad">
          <div class="card-header"><div><h3>Presenças e faltas</h3><p>A falta online vale pelo conjunto semanal.</p></div></div>
          <div class="list">${absences.length ? absences.map((absence) => `
            <article class="list-item"><div class="list-item__main"><span class="list-item__icon">${absence.kind === 'live' ? '●' : '✓'}</span><div class="list-item__copy"><strong>${absence.kind === 'live' ? 'Falta na aula ao vivo' : 'Falta online semanal'}</strong><span>${escapeHTML(absence.reason || absence.reference_key)} · ${formatDate(absence.created_at, false)}</span></div></div>${statusBadge(absence.justified ? 'Justificada' : 'Registrada', absence.justified ? 'success' : 'danger')}</article>
          `).join('') : emptyState('✓', 'Nenhuma falta', 'Seu histórico de presença está em dia.')}</div>
        </section>
      </div>
    `;
  }

  function renderNotices() {
    const notices = state.data.notices || [];
    const teacherActions = state.user.role === 'teacher'
      ? '<button class="btn btn--primary" data-action="new-notice">＋ Novo aviso</button>'
      : '';
    elements.content.innerHTML = `
      ${pageHeader({ eyebrow: 'COMUNICAÇÃO DIRETA', title: 'Avisos do curso', description: state.user.role === 'teacher' ? 'Envie mensagens para toda a turma ou para um aluno específico.' : 'Acompanhe recados, mudanças de prazo e orientações do professor.', actions: teacherActions })}
      <div class="grid">
        ${notices.length ? notices.map((notice) => `
          <article class="notice-card">
            <span class="notice-card__icon">!</span>
            <div><h3>${escapeHTML(notice.title)}</h3><p>${escapeHTML(notice.message)}</p>${state.user.role === 'teacher' ? `<span class="badge badge--muted" style="margin-top:10px">${notice.student_name ? `Para ${escapeHTML(notice.student_name)}` : 'Para toda a turma'}</span>` : ''}</div>
            <time>${formatDate(notice.created_at)}</time>
          </article>
        `).join('') : emptyState('!', 'Nenhum aviso', 'As mensagens do professor aparecerão aqui.')}
      </div>
    `;
  }

  function renderProfile() {
    const user = state.data.student || state.user;
    elements.content.innerHTML = `
      ${pageHeader({ eyebrow: 'SUA CONTA', title: 'Perfil do aluno', description: 'Confira os dados vinculados ao seu acesso individual.' })}
      <section class="card profile-card">
        <div class="profile-avatar">${escapeHTML(user.avatar || initials(user.name))}</div>
        <div class="profile-info">
          <h2>${escapeHTML(user.name)}</h2><p>${escapeHTML(user.email)}</p>
          <div class="detail-grid">
            <div class="detail-item"><small>Tipo de acesso</small><strong>Aluno</strong></div>
            <div class="detail-item"><small>Status</small><strong class="text-success">Ativo</strong></div>
            <div class="detail-item"><small>Curso</small><strong>${escapeHTML(state.data.settings.course_name)}</strong></div>
            <div class="detail-item"><small>Proteção</small><strong>${state.data.settings.content_protection ? 'Marca d’água ativa' : 'Desativada'}</strong></div>
          </div>
        </div>
      </section>
      <section class="card card--pad section">
        <div class="card-header"><div><h3>Segurança do acesso</h3><p>Este link foi criado exclusivamente para seu e-mail.</p></div>${statusBadge('Sessão única', 'success')}</div>
        <p style="margin:0;color:var(--muted);font-size:.82rem;line-height:1.65">Ao entrar em outro dispositivo, a sessão anterior é encerrada. Não compartilhe seu link, senha ou gravações das aulas.</p>
      </section>
    `;
  }

  function renderTeacherDashboard() {
    const { summary, reports, attempts, liveClasses } = state.data;
    const live = liveClasses.find((item) => item.status !== 'finished') || liveClasses[0];
    elements.content.innerHTML = `
      ${pageHeader({
        eyebrow: 'PAINEL DO PROFESSOR',
        title: `Olá, ${state.user.name.split(' ')[0]}.`,
        description: 'Acompanhe a turma, publique conteúdos e veja quem precisa de atenção.',
        actions: '<button class="btn btn--outline" data-action="new-notice">Enviar aviso</button><button class="btn btn--primary" data-action="new-activity">＋ Nova atividade</button>'
      })}
      <div class="stats-grid">
        ${statCard('Alunos cadastrados', `${summary.students}`, `${summary.activeStudents} ativos`)}
        ${statCard('Unidades', `${summary.units}`, 'publicadas')}
        ${statCard('Atividades', `${summary.activities}`, 'no curso')}
        ${statCard('Abaixo do mínimo', `${summary.pending}`, 'alunos')}
        ${statCard('Próxima aula', live ? relativeDate(live.starts_at) : '—', live ? formatDate(live.starts_at) : 'Não agendada', true)}
      </div>
      <div class="dashboard-grid">
        <section class="card card--pad">
          <div class="card-header"><div><h3>Progresso da turma</h3><p>Visão rápida de cada aluno.</p></div><button class="btn btn--quiet" data-page="reports">Relatórios</button></div>
          <div class="list">${reports.slice(0, 6).map((report) => `
            <article class="list-item"><div class="list-item__main"><span class="avatar">${escapeHTML(report.avatar || initials(report.name))}</span><div class="list-item__copy"><strong>${escapeHTML(report.name)}</strong><span>${report.completed}/${report.total} atividades · Nota ${report.grade}</span></div></div><div class="list-item__side"><div style="width:95px"><div class="progress-bar"><span style="width:${report.progress}%"></span></div></div>${statusBadge(`${report.progress}%`, report.progress >= state.data.settings.weekly_minimum_percent ? 'success' : 'warning')}</div></article>
          `).join('')}</div>
        </section>
        <aside class="grid">
          ${live ? `<section class="card card--dark card--pad"><div class="card-header"><div><h3>Próxima aula ao vivo</h3><p style="color:rgba(255,255,255,.58)">${formatDate(live.starts_at)}</p></div>${statusBadge(live.status === 'live' ? 'Ao vivo' : 'Agendada', live.status === 'live' ? 'danger' : 'orange')}</div><h4 style="margin:0 0 18px;font-family:Georgia,serif;font-size:1.25rem;font-weight:500">${escapeHTML(live.title)}</h4><button class="btn btn--orange" data-page="live">Gerenciar aula</button></section>` : ''}
          <section class="card card--pad"><div class="card-header"><div><h3>Respostas recentes</h3><p>Últimas atividades enviadas.</p></div></div><div class="list">${attempts.slice(0, 4).map((attempt) => `<article class="list-item"><div class="list-item__main"><span class="list-item__icon">${activityIcon(attempt.activity_type)}</span><div class="list-item__copy"><strong>${escapeHTML(attempt.student_name)}</strong><span>${escapeHTML(attempt.activity_title)}</span></div></div>${statusBadge(`${attempt.score}`, attempt.correct ? 'success' : 'warning')}</article>`).join('') || '<p class="muted">Nenhuma resposta.</p>'}</div></section>
        </aside>
      </div>
    `;
  }

  function renderStudents() {
    const students = state.data.students;
    elements.content.innerHTML = `
      ${pageHeader({ eyebrow: 'GESTÃO DA TURMA', title: 'Alunos cadastrados', description: 'Cadastre, edite, bloqueie, remova e gere o link individual de cada aluno.', actions: '<button class="btn btn--primary" data-action="new-student">＋ Cadastrar aluno</button>' })}
      <section class="card card--pad" style="margin-bottom:18px">
        <div class="inline-form"><label class="field"><span>Buscar aluno</span><input id="student-search" type="search" placeholder="Nome ou e-mail"></label><button class="btn btn--outline" data-action="copy-all-links">Copiar links da turma</button></div>
      </section>
      <div class="table-wrap">
        <table><thead><tr><th>Aluno</th><th>Status</th><th>Link individual</th><th>Cadastrado</th><th>Ações</th></tr></thead><tbody id="students-table-body">${students.map(studentRow).join('')}</tbody></table>
      </div>
    `;
  }

  function studentRow(student) {
    return `<tr data-student-row="${student.id}" data-search="${escapeHTML(`${student.name} ${student.email}`.toLowerCase())}">
      <td><div class="table-user"><span class="avatar">${escapeHTML(student.avatar || initials(student.name))}</span><div><strong>${escapeHTML(student.name)}</strong><span>${escapeHTML(student.email)}</span></div></div></td>
      <td>${statusBadge(student.blocked ? 'Bloqueado' : 'Ativo', student.blocked ? 'danger' : 'success')}</td>
      <td><button class="btn btn--quiet" data-action="copy-link" data-student-id="${student.id}">Copiar link</button></td>
      <td>${formatDate(student.created_at || new Date(), false)}</td>
      <td><div class="table-actions"><button class="action-button" title="Editar" data-action="edit-student" data-student-id="${student.id}">✎</button><button class="action-button" title="${student.blocked ? 'Desbloquear' : 'Bloquear'}" data-action="toggle-student" data-student-id="${student.id}">${student.blocked ? '✓' : '⊘'}</button><button class="action-button" title="Gerar novo link" data-action="new-link" data-student-id="${student.id}">↻</button><button class="action-button" title="Remover" data-action="delete-student" data-student-id="${student.id}">×</button></div></td>
    </tr>`;
  }

  function renderBuilder() {
    const units = state.data.units;
    elements.content.innerHTML = `
      ${pageHeader({ eyebrow: 'CONTEÚDO DO CURSO', title: 'Aulas e atividades', description: 'Crie unidades, envie mídia e organize os exercícios da semana.', actions: '<button class="btn btn--outline" data-action="new-unit">＋ Unidade</button><button class="btn btn--outline" data-action="new-lesson">＋ Aula</button><button class="btn btn--primary" data-action="new-activity">＋ Atividade</button>' })}
      <div class="grid">
        ${units.map((unit, unitIndex) => `
          <section class="card card--pad">
            <div class="card-header"><div><span class="badge">UNIT ${String(unitIndex + 1).padStart(2, '0')}</span><h3 style="margin-top:10px">${escapeHTML(unit.title)}</h3><p>${escapeHTML(unit.description)}</p></div><div class="table-actions"><button class="action-button" data-action="edit-unit" data-unit-id="${unit.id}">✎</button><button class="action-button" data-action="delete-unit" data-unit-id="${unit.id}">×</button></div></div>
            <div class="list">${unit.lessons.map((lesson) => `
              <article class="list-item"><div class="list-item__main"><span class="list-item__icon">▤</span><div class="list-item__copy"><strong>${escapeHTML(lesson.title)}</strong><span>${escapeHTML(lesson.summary)} · ${lesson.activities.length} atividades</span></div></div><div class="list-item__side"><button class="btn btn--quiet" data-action="new-activity" data-lesson-id="${lesson.id}">＋ Atividade</button><button class="btn btn--outline" data-action="view-lesson" data-lesson-id="${lesson.id}">Ver</button></div></article>
            `).join('') || emptyState('▤', 'Nenhuma aula', 'Adicione a primeira aula desta unidade.')}</div>
          </section>
        `).join('') || emptyState('＋', 'Nenhuma unidade', 'Crie a primeira unidade do curso.')}
      </div>
    `;
  }

  function renderAttendance() {
    const reports = state.data.reports;
    const absences = state.data.absences;
    elements.content.innerHTML = `
      ${pageHeader({ eyebrow: 'CONTROLE SEMANAL', title: 'Presenças e faltas', description: 'A falta ao vivo considera o tempo conectado. A falta online considera o conjunto obrigatório da semana.' })}
      <div class="grid grid--2" style="margin-bottom:20px">
        <section class="card card--pad"><div class="card-header"><div><h3>Presença online semanal</h3><p>Mínimo definido: ${state.data.settings.weekly_minimum_percent}%</p></div></div><div class="list">${reports.map((report) => `<article class="list-item"><div class="list-item__main"><span class="avatar">${escapeHTML(report.avatar || initials(report.name))}</span><div class="list-item__copy"><strong>${escapeHTML(report.name)}</strong><span>${report.completed}/${report.total} atividades obrigatórias</span></div></div>${statusBadge(report.progress >= state.data.settings.weekly_minimum_percent ? 'Presente' : 'Abaixo do mínimo', report.progress >= state.data.settings.weekly_minimum_percent ? 'success' : 'danger')}</article>`).join('')}</div></section>
        <section class="card card--pad"><div class="card-header"><div><h3>Regra da aula ao vivo</h3><p>Tempo mínimo: ${state.data.settings.live_minimum_percent}%</p></div></div><p style="margin:0;color:var(--muted);font-size:.82rem;line-height:1.7">O sistema soma o tempo em que o aluno permanece conectado na sala. Ao final, o professor pode revisar, justificar ou remover a falta.</p></section>
      </div>
      <section class="card card--pad">
        <div class="card-header"><div><h3>Faltas registradas</h3><p>Histórico de faltas ao vivo e online.</p></div></div>
        <div class="table-wrap"><table><thead><tr><th>Aluno</th><th>Tipo</th><th>Motivo</th><th>Status</th><th>Ações</th></tr></thead><tbody>${absences.length ? absences.map((absence) => `<tr><td><strong>${escapeHTML(absence.student_name)}</strong><br><span class="muted">${escapeHTML(absence.student_email)}</span></td><td>${absence.kind === 'live' ? 'Aula ao vivo' : 'Online semanal'}</td><td>${escapeHTML(absence.reason || absence.reference_key)}</td><td>${statusBadge(absence.justified ? 'Justificada' : 'Registrada', absence.justified ? 'success' : 'danger')}</td><td><div class="table-actions"><button class="action-button" data-action="justify-absence" data-absence-id="${absence.id}">${absence.justified ? '↶' : '✓'}</button><button class="action-button" data-action="delete-absence" data-absence-id="${absence.id}">×</button></div></td></tr>`).join('') : '<tr><td colspan="5">Nenhuma falta registrada.</td></tr>'}</tbody></table></div>
      </section>
    `;
  }

  function renderReports() {
    const reports = state.data.reports;
    const selected = reports.find((report) => report.id === state.activeReportStudentId) || reports[0];
    if (!selected) {
      elements.content.innerHTML = emptyState('↗', 'Nenhum aluno', 'Cadastre um aluno para gerar relatórios.');
      return;
    }
    state.activeReportStudentId = selected.id;
    elements.content.innerHTML = `
      ${pageHeader({ eyebrow: 'RELATÓRIO INDIVIDUAL', title: 'Desempenho dos alunos', description: 'Selecione um aluno para visualizar progresso, notas, entregas e faltas.', actions: '<button class="btn btn--outline" data-action="print-report">Imprimir relatório</button>' })}
      <div class="lesson-layout">
        <aside class="lesson-sidebar">
          <section class="card card--pad"><div class="card-header"><div><h4>Alunos</h4><p>Escolha um perfil.</p></div></div><div class="list">${reports.map((report) => `<button class="lesson-nav-button ${report.id === selected.id ? 'is-active' : ''}" data-report-student="${report.id}"><span class="avatar">${escapeHTML(report.avatar || initials(report.name))}</span><span><strong>${escapeHTML(report.name)}</strong><small>${report.progress}% concluído</small></span></button>`).join('')}</div></section>
        </aside>
        <div class="lesson-main">
          <section class="report-hero"><span class="avatar">${escapeHTML(selected.avatar || initials(selected.name))}</span><div><h2>${escapeHTML(selected.name)}</h2><p>${escapeHTML(selected.email)}</p></div><div class="report-score"><strong>${selected.grade}</strong><span>Nota média</span></div></section>
          <div class="stats-grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">${statCard('Progresso', `${selected.progress}%`, 'do curso')}${statCard('Concluídas', `${selected.completed}`, `de ${selected.total}`)}${statCard('Faltas', `${selected.absences}`, 'não justificadas', selected.absences > 0)}${statCard('Status', selected.blocked ? 'Bloqueado' : 'Ativo', 'acesso')}</div>
          <section class="card card--pad"><div class="card-header"><div><h3>Resumo individual</h3><p>Dados atualizados pelas atividades e faltas registradas.</p></div></div><div class="progress-bar"><span style="width:${selected.progress}%"></span></div><p style="color:var(--muted);font-size:.8rem;line-height:1.6">${selected.progress >= state.data.settings.weekly_minimum_percent ? 'O aluno atingiu a porcentagem mínima semanal.' : 'O aluno está abaixo da porcentagem mínima e precisa concluir mais atividades.'}</p><button class="btn btn--primary" data-action="load-full-report" data-student-id="${selected.id}">Abrir detalhes completos</button></section>
        </div>
      </div>
    `;
  }

  function renderSettings() {
    const settings = state.data.settings;
    elements.content.innerHTML = `
      ${pageHeader({ eyebrow: 'REGRAS DO CURSO', title: 'Configurações', description: 'Defina os percentuais mínimos, a sala ao vivo e a proteção de conteúdo.' })}
      <form id="settings-form" class="grid">
        <section class="card card--pad"><div class="card-header"><div><h3>Identidade do curso</h3><p>Nome exibido na plataforma.</p></div></div><div class="form-grid"><label class="field"><span>Nome da escola</span><input name="schoolName" value="${escapeHTML(settings.school_name)}"></label><label class="field"><span>Nome do curso</span><input name="courseName" value="${escapeHTML(settings.course_name)}"></label></div></section>
        <section class="card card--pad"><div class="card-header"><div><h3>Presença e faltas</h3><p>Percentuais mínimos usados pelo sistema.</p></div></div><div class="form-grid"><label class="field"><span>Mínimo de atividades semanais (%)</span><input name="weeklyMinimumPercent" type="number" min="1" max="100" value="${settings.weekly_minimum_percent}"></label><label class="field"><span>Tempo mínimo na aula ao vivo (%)</span><input name="liveMinimumPercent" type="number" min="1" max="100" value="${settings.live_minimum_percent}"></label></div></section>
        <section class="card card--pad"><div class="card-header"><div><h3>Aula ao vivo</h3><p>Endereço padrão da sala de videochamada.</p></div></div><div class="form-grid"><label class="field field--full"><span>URL da sala</span><input name="liveRoomUrl" type="url" value="${escapeHTML(settings.live_room_url)}"></label><label class="field"><span>Fuso horário</span><input name="timezone" value="${escapeHTML(settings.timezone)}"></label></div></section>
        <section class="switch-row"><div><strong>Proteção do conteúdo</strong><span>Bloqueia seleção, cópia, botão direito e exibe marca d’água para o aluno.</span></div><button id="content-protection-switch" class="switch ${settings.content_protection ? 'is-on' : ''}" type="button" aria-label="Ativar ou desativar proteção"></button><input name="contentProtection" type="hidden" value="${settings.content_protection ? '1' : '0'}"></section>
        <div><button class="btn btn--primary btn--large" type="submit">Salvar configurações</button></div>
      </form>
    `;
  }

  async function renderLiveClass() {
    const live = state.user.role === 'teacher'
      ? state.data.liveClasses?.find((item) => item.status !== 'finished') || state.data.liveClasses?.[0]
      : state.data.liveClass;
    if (!live) {
      elements.content.innerHTML = `
        ${pageHeader({ eyebrow: 'CONVERSAÇÃO', title: 'Aula ao vivo', description: 'O professor ainda não agendou a próxima aula.', actions: state.user.role === 'teacher' ? '<button class="btn btn--primary" data-action="new-live-class">＋ Agendar aula</button>' : '' })}
        ${emptyState('●', 'Nenhuma aula agendada', 'Quando uma aula for criada, a sala aparecerá aqui.')}
      `;
      return;
    }
    const questions = await loadLiveQuestions(live.id);
    const published = questions.find((question) => question.published) || questions[0];
    elements.content.innerHTML = `
      ${pageHeader({
        eyebrow: live.status === 'live' ? 'AO VIVO AGORA' : 'AULA AGENDADA',
        title: live.title,
        description: `${formatDate(live.starts_at)} · ${live.duration_minutes} minutos · Presença mínima de ${live.minimum_percent}%`,
        actions: state.user.role === 'teacher' ? '<button class="btn btn--outline" data-action="new-live-class">Agendar outra</button>' : ''
      })}
      <div class="live-layout">
        <div class="video-room"><iframe src="${escapeHTML(live.room_url)}#config.prejoinPageEnabled=false&config.disableDeepLinking=true" title="Sala de videochamada" allow="camera; microphone; fullscreen; display-capture; autoplay"></iframe></div>
        <aside class="live-panel" data-live-id="${live.id}">
          <div class="live-status"><span class="live-dot">Sala conectada</span><span id="presence-label" class="badge badge--success">Presença sendo registrada</span></div>
          ${state.user.role === 'teacher' ? renderTeacherLivePanel(live, questions, published) : renderStudentLivePanel(live, published)}
        </aside>
      </div>
    `;
    startLiveTimers(live);
  }

  async function loadLiveQuestions(liveId) {
    if (state.mode === 'server') {
      try {
        const payload = await api(`/api/live/${liveId}/questions`);
        return payload.questions || [];
      } catch {
        return [];
      }
    }
    const db = getDemoDB();
    return db.liveQuestions.filter((question) => question.live_class_id === Number(liveId)).map((question) => {
      const own = db.liveAnswers.find((answer) => answer.question_id === question.id && answer.student_id === state.user.id);
      return state.user.role === 'teacher'
        ? { ...question, answer_count: db.liveAnswers.filter((answer) => answer.question_id === question.id).length, selected_student_name: db.users.find((user) => user.id === question.selected_student_id)?.name }
        : { ...question, correct_answer: question.answers_released ? question.correct_answer : '', own_answer: own?.answer_text || '', own_audio: own?.audio_url || '' };
    });
  }

  function renderStudentLivePanel(live, question) {
    if (!question || !question.published) return '<div class="live-empty"><div><span class="empty-state__icon">…</span><h3>Aguardando o professor</h3><p>A pergunta aparecerá aqui quando for publicada.</p></div></div>';
    return `
      <div class="live-question"><div style="display:flex;justify-content:space-between;gap:12px"><small>Pergunta ao vivo</small><span id="live-countdown" class="countdown">${question.time_limit_seconds}s</span></div><h3>${escapeHTML(question.prompt)}</h3>${question.selected_student_id === state.user.id ? statusBadge('Você foi escolhido para responder falando', 'orange') : ''}</div>
      <form id="live-answer-form" class="live-answer-form" data-question-id="${question.id}" data-response-type="${question.response_type}">
        ${question.response_type === 'audio' ? '<button id="live-audio-button" class="btn btn--orange" type="button">◉ Gravar resposta em áudio</button><audio id="live-audio-preview" class="is-hidden" controls></audio><input id="live-answer-input" type="hidden">' : `<label class="field"><span>Sua resposta</span><textarea id="live-answer-input" placeholder="Digite sua resposta em inglês...">${escapeHTML(question.own_answer || '')}</textarea></label>`}
        <button class="btn btn--primary" type="submit">Enviar resposta</button>
      </form>
      ${question.answers_released ? `<div class="exercise-result"><strong>Resposta correta</strong><p>${escapeHTML(question.correct_answer)}</p></div>` : '<p class="muted" style="margin-top:15px;font-size:.76rem;line-height:1.5">As respostas dos outros alunos ficam ocultas até o professor liberar.</p>'}
    `;
  }

  function renderTeacherLivePanel(live, questions, selected) {
    return `
      <div class="live-teacher-tools">
        <button class="btn btn--primary" data-action="new-live-question" data-live-id="${live.id}">＋ Criar pergunta</button>
        <div class="list">${questions.length ? questions.map((question) => `
          <article class="list-item"><div class="list-item__main"><span class="list-item__icon">?</span><div class="list-item__copy"><strong>${escapeHTML(question.prompt)}</strong><span>${question.answer_count || 0} respostas · ${question.time_limit_seconds}s</span></div></div><div class="list-item__side"><button class="action-button" data-action="publish-question" data-question-id="${question.id}" title="Publicar">${question.published ? '■' : '▶'}</button><button class="action-button" data-action="release-answers" data-question-id="${question.id}" title="Liberar respostas">✓</button><button class="action-button" data-action="view-live-answers" data-question-id="${question.id}" title="Ver respostas">◎</button></div></article>
        `).join('') : '<p class="muted">Nenhuma pergunta criada.</p>'}</div>
        ${selected?.selected_student_name ? `<div class="exercise-result"><strong>Aluno escolhido</strong><p>${escapeHTML(selected.selected_student_name)}</p></div>` : ''}
      </div>
    `;
  }

  function startLiveTimers(live) {
    stopLiveTimers();
    if (state.user.role === 'student') {
      const ping = async () => {
        try {
          if (state.mode === 'server') {
            const payload = await api(`/api/live/${live.id}/ping`, { method: 'POST', body: JSON.stringify({ seconds: 15 }) });
            const label = $('#presence-label');
            if (label) label.textContent = `${payload.presence.percentage}% de presença`;
          } else {
            demoLivePing(live);
          }
        } catch {
          // Mantém a aula aberta mesmo se a rede oscilar.
        }
      };
      ping();
      state.liveTimer = setInterval(ping, 15000);
      const countdown = $('#live-countdown');
      if (countdown) {
        let seconds = Number(countdown.textContent.replace(/\D/g, '')) || 60;
        const countdownTimer = setInterval(() => {
          if (!document.body.contains(countdown)) return clearInterval(countdownTimer);
          seconds = Math.max(0, seconds - 1);
          countdown.textContent = `${seconds}s`;
        }, 1000);
      }
      $('#live-audio-button')?.addEventListener('click', toggleLiveAudio);
    }
    state.livePoll = setInterval(async () => {
      if (state.page === 'live') await renderLiveClass();
    }, 12000);
  }

  function stopLiveTimers() {
    clearInterval(state.liveTimer);
    clearInterval(state.livePoll);
    state.liveTimer = null;
    state.livePoll = null;
  }

  function demoLivePing(live) {
    const db = getDemoDB();
    let presence = db.livePresence.find((item) => item.live_class_id === live.id && item.student_id === state.user.id);
    if (!presence) {
      presence = { id: Date.now(), live_class_id: live.id, student_id: state.user.id, joined_at: new Date().toISOString(), seconds_present: 0, percentage: 0, status: 'pending' };
      db.livePresence.push(presence);
    }
    presence.seconds_present += 15;
    presence.percentage = Math.min(100, Math.round((presence.seconds_present / (live.duration_minutes * 60)) * 1000) / 10);
    presence.status = presence.percentage >= live.minimum_percent ? 'present' : 'pending';
    saveDemoDB(db);
    const label = $('#presence-label');
    if (label) label.textContent = `${presence.percentage}% de presença`;
  }

  async function toggleLiveAudio() {
    const button = $('#live-audio-button');
    if (state.mediaRecorder?.state === 'recording') {
      state.mediaRecorder.stop();
      button.textContent = '◉ Gravar novamente';
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.audioChunks = [];
      state.mediaRecorder = new MediaRecorder(stream);
      state.mediaRecorder.ondataavailable = (event) => event.data.size && state.audioChunks.push(event.data);
      state.mediaRecorder.onstop = () => {
        state.audioBlob = new Blob(state.audioChunks, { type: state.mediaRecorder.mimeType || 'audio/webm' });
        const preview = $('#live-audio-preview');
        preview.src = URL.createObjectURL(state.audioBlob);
        preview.classList.remove('is-hidden');
        stream.getTracks().forEach((track) => track.stop());
      };
      state.mediaRecorder.start();
      button.textContent = '■ Parar gravação';
    } catch (error) {
      toast('Microfone indisponível', error.message, 'error');
    }
  }

  async function submitLiveAnswer(form) {
    const questionId = Number(form.dataset.questionId);
    let answerText = $('#live-answer-input')?.value?.trim() || '';
    let audioUrl = '';
    if (form.dataset.responseType === 'audio') {
      if (!state.audioBlob) return toast('Grave sua resposta', 'Use o botão de áudio antes de enviar.', 'error');
      audioUrl = state.mode === 'server' ? await uploadBlob(state.audioBlob, 'resposta-ao-vivo.webm') : URL.createObjectURL(state.audioBlob);
    } else if (!answerText) {
      return toast('Digite sua resposta', '', 'error');
    }
    try {
      if (state.mode === 'server') {
        await api(`/api/live/questions/${questionId}/answer`, { method: 'POST', body: JSON.stringify({ answerText, audioUrl }) });
      } else {
        const db = getDemoDB();
        const existing = db.liveAnswers.find((answer) => answer.question_id === questionId && answer.student_id === state.user.id);
        if (existing) Object.assign(existing, { answer_text: answerText, audio_url: audioUrl, created_at: new Date().toISOString() });
        else db.liveAnswers.push({ id: db.counters.answer++, question_id: questionId, student_id: state.user.id, answer_text: answerText, audio_url: audioUrl, created_at: new Date().toISOString() });
        saveDemoDB(db);
      }
      toast('Resposta enviada', 'Os colegas não verão sua resposta antes da liberação do professor.');
    } catch (error) {
      toast('Falha ao enviar', error.message, 'error');
    }
  }

  function modalNewStudent(student = null) {
    openModal({
      title: student ? 'Editar aluno' : 'Cadastrar aluno',
      subtitle: 'O link individual será gerado automaticamente.',
      body: `<form id="student-form" data-student-id="${student?.id || ''}" class="form-stack"><label class="field"><span>Nome completo</span><input name="name" value="${escapeHTML(student?.name || '')}" required></label><label class="field"><span>E-mail</span><input name="email" type="email" value="${escapeHTML(student?.email || '')}" required></label>${student ? '' : '<label class="field"><span>Senha inicial</span><input name="password" value="Aluno123" required></label>'}</form>`,
      footer: '<button class="btn btn--outline" data-action="close-modal">Cancelar</button><button class="btn btn--primary" type="submit" form="student-form">Salvar aluno</button>'
    });
  }

  async function saveStudent(form) {
    const data = Object.fromEntries(new FormData(form));
    const id = Number(form.dataset.studentId || 0);
    try {
      if (state.mode === 'server') {
        const payload = await api(id ? `/api/teacher/students/${id}` : '/api/teacher/students', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
        state.data = payload.dashboard;
      } else {
        const db = getDemoDB();
        if (id) {
          const student = db.users.find((user) => user.id === id);
          Object.assign(student, { name: data.name.trim(), email: data.email.trim().toLowerCase(), avatar: initials(data.name) });
        } else {
          if (db.users.some((user) => user.email.toLowerCase() === data.email.trim().toLowerCase())) throw new Error('Já existe um usuário com este e-mail.');
          db.users.push({ id: db.counters.user++, role: 'student', name: data.name.trim(), email: data.email.trim().toLowerCase(), password: data.password || 'Aluno123', avatar: initials(data.name), blocked: false, access_token: `student-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`, created_at: new Date().toISOString() });
        }
        saveDemoDB(db);
        state.data = demoTeacherDashboard();
      }
      closeModal();
      renderStudents();
      renderShell();
      toast('Aluno salvo', id ? 'Cadastro atualizado.' : 'Link individual criado com sucesso.');
    } catch (error) {
      toast('Não foi possível salvar', error.message, 'error');
    }
  }

  function modalNewUnit(unit = null) {
    openModal({
      title: unit ? 'Editar unidade' : 'Criar unidade',
      body: `<form id="unit-form" data-unit-id="${unit?.id || ''}" class="form-stack"><label class="field"><span>Título</span><input name="title" value="${escapeHTML(unit?.title || '')}" required></label><label class="field"><span>Descrição</span><textarea name="description">${escapeHTML(unit?.description || '')}</textarea></label></form>`,
      footer: '<button class="btn btn--outline" data-action="close-modal">Cancelar</button><button class="btn btn--primary" type="submit" form="unit-form">Salvar unidade</button>'
    });
  }

  async function saveUnit(form) {
    const values = Object.fromEntries(new FormData(form));
    const id = Number(form.dataset.unitId || 0);
    try {
      if (state.mode === 'server') {
        const payload = await api(id ? `/api/teacher/units/${id}` : '/api/teacher/units', { method: id ? 'PUT' : 'POST', body: JSON.stringify(values) });
        state.data = payload.dashboard;
      } else {
        const db = getDemoDB();
        if (id) Object.assign(db.units.find((unit) => unit.id === id), { title: values.title, description: values.description });
        else db.units.push({ id: db.counters.unit++, title: values.title, description: values.description, position: db.units.length + 1, published: true, lessons: [] });
        saveDemoDB(db);
        state.data = demoTeacherDashboard();
      }
      closeModal(); renderBuilder(); toast('Unidade salva');
    } catch (error) { toast('Erro ao salvar', error.message, 'error'); }
  }

  function modalNewLesson() {
    openModal({
      title: 'Criar aula',
      subtitle: 'A aula pode conter vídeo, texto, exemplos, imagem e áudio.',
      body: `<form id="lesson-form" class="form-stack"><label class="field"><span>Unidade</span><select name="unitId" required>${state.data.units.map((unit) => `<option value="${unit.id}">${escapeHTML(unit.title)}</option>`).join('')}</select></label><label class="field"><span>Título da aula</span><input name="title" required></label><label class="field"><span>Resumo</span><input name="summary"></label><label class="field"><span>Explicação escrita</span><textarea name="writtenContent"></textarea></label><label class="field"><span>Exemplos, um por linha</span><textarea name="examples"></textarea></label><label class="field"><span>URL da videoaula</span><input name="videoUrl" type="url" placeholder="https://www.youtube.com/embed/..."></label></form>`,
      footer: '<button class="btn btn--outline" data-action="close-modal">Cancelar</button><button class="btn btn--primary" type="submit" form="lesson-form">Criar aula</button>'
    });
  }

  async function saveLesson(form) {
    const raw = Object.fromEntries(new FormData(form));
    const values = { ...raw, unitId: Number(raw.unitId), examples: raw.examples.split('\n').map((item) => item.trim()).filter(Boolean) };
    try {
      if (state.mode === 'server') {
        const payload = await api('/api/teacher/lessons', { method: 'POST', body: JSON.stringify(values) });
        state.data = payload.dashboard;
      } else {
        const db = getDemoDB();
        const unit = db.units.find((item) => item.id === values.unitId);
        unit.lessons.push({ id: db.counters.lesson++, unit_id: unit.id, title: values.title, summary: values.summary, written_content: values.writtenContent, examples: values.examples, video_url: values.videoUrl, audio_url: '', image_url: '', position: unit.lessons.length + 1, published: true, activities: [] });
        saveDemoDB(db); state.data = demoTeacherDashboard();
      }
      closeModal(); renderBuilder(); toast('Aula criada');
    } catch (error) { toast('Erro ao criar aula', error.message, 'error'); }
  }

  function modalNewActivity(preselectedLessonId = '') {
    const lessons = state.data.units.flatMap((unit) => unit.lessons.map((lesson) => ({ ...lesson, unitTitle: unit.title })));
    openModal({
      title: 'Criar atividade',
      subtitle: 'Defina a correção, o prazo e se a atividade conta para a presença semanal.',
      wide: true,
      body: `<form id="activity-create-form" class="form-grid"><label class="field"><span>Aula</span><select name="lessonId" required>${lessons.map((lesson) => `<option value="${lesson.id}" ${Number(preselectedLessonId) === lesson.id ? 'selected' : ''}>${escapeHTML(lesson.unitTitle)} — ${escapeHTML(lesson.title)}</option>`).join('')}</select></label><label class="field"><span>Tipo</span><select name="type"><option value="multiple_choice">Alternativas</option><option value="fill_blank">Completar frase</option><option value="writing">Escrita</option><option value="listening">Escuta</option><option value="pronunciation">Pronúncia</option></select></label><label class="field field--full"><span>Título</span><input name="title" required></label><label class="field field--full"><span>Enunciado</span><textarea name="prompt" required></textarea></label><label class="field field--full"><span>Alternativas, uma por linha</span><textarea name="options"></textarea></label><label class="field"><span>Resposta correta</span><input name="correctAnswer"></label><label class="field"><span>Pontos</span><input name="points" type="number" value="10" min="1" max="100"></label><label class="field field--full"><span>Explicação quando errar</span><textarea name="explanation"></textarea></label><label class="field"><span>Prazo</span><input name="dueAt" type="datetime-local"></label><label class="field"><span>Semana</span><input name="weekLabel" value="Semana atual"></label><label class="field field--full"><span>URL de áudio, vídeo ou imagem</span><input name="mediaUrl" type="url"></label><label class="switch-row field--full"><div><strong>Atividade obrigatória</strong><span>Conta para a presença online semanal.</span></div><button id="activity-required-switch" class="switch is-on" type="button"></button><input name="required" type="hidden" value="1"></label></form>`,
      footer: '<button class="btn btn--outline" data-action="close-modal">Cancelar</button><button class="btn btn--primary" type="submit" form="activity-create-form">Criar atividade</button>'
    });
  }

  async function saveActivity(form) {
    const raw = Object.fromEntries(new FormData(form));
    const values = { ...raw, lessonId: Number(raw.lessonId), points: Number(raw.points), required: raw.required === '1', options: raw.options.split('\n').map((item) => item.trim()).filter(Boolean), dueAt: raw.dueAt ? new Date(raw.dueAt).toISOString() : null };
    try {
      if (state.mode === 'server') {
        const payload = await api('/api/teacher/activities', { method: 'POST', body: JSON.stringify(values) });
        state.data = payload.dashboard;
      } else {
        const db = getDemoDB();
        const lesson = db.units.flatMap((unit) => unit.lessons).find((item) => item.id === values.lessonId);
        lesson.activities.push({ id: db.counters.activity++, lesson_id: lesson.id, week_label: values.weekLabel, title: values.title, type: values.type, prompt: values.prompt, options: values.options, correct_answer: values.correctAnswer, explanation: values.explanation, media_url: values.mediaUrl, required: values.required, points: values.points, due_at: values.dueAt, position: lesson.activities.length + 1 });
        saveDemoDB(db); state.data = demoTeacherDashboard();
      }
      closeModal(); renderBuilder(); renderShell(); toast('Atividade criada');
    } catch (error) { toast('Erro ao criar atividade', error.message, 'error'); }
  }

  function modalNewNotice() {
    const students = state.user.role === 'teacher' ? state.data.students : [];
    openModal({
      title: 'Enviar aviso',
      body: `<form id="notice-form" class="form-stack"><label class="field"><span>Destinatário</span><select name="studentId"><option value="">Toda a turma</option>${students.map((student) => `<option value="${student.id}">${escapeHTML(student.name)}</option>`).join('')}</select></label><label class="field"><span>Título</span><input name="title" required></label><label class="field"><span>Mensagem</span><textarea name="message" required></textarea></label></form>`,
      footer: '<button class="btn btn--outline" data-action="close-modal">Cancelar</button><button class="btn btn--primary" type="submit" form="notice-form">Enviar aviso</button>'
    });
  }

  async function saveNotice(form) {
    const values = Object.fromEntries(new FormData(form));
    try {
      if (state.mode === 'server') {
        const payload = await api('/api/teacher/notices', { method: 'POST', body: JSON.stringify(values) });
        state.data = payload.dashboard;
      } else {
        const db = getDemoDB();
        db.notices.push({ id: db.counters.notice++, teacher_id: state.user.id, student_id: values.studentId ? Number(values.studentId) : null, title: values.title, message: values.message, created_at: new Date().toISOString() });
        saveDemoDB(db); state.data = demoTeacherDashboard();
      }
      closeModal(); renderNotices(); renderShell(); toast('Aviso enviado');
    } catch (error) { toast('Erro ao enviar aviso', error.message, 'error'); }
  }

  function modalNewLiveClass() {
    openModal({ title: 'Agendar aula ao vivo', body: `<form id="live-class-form" class="form-stack"><label class="field"><span>Título</span><input name="title" value="Conversation Club" required></label><label class="field"><span>Data e horário</span><input name="startsAt" type="datetime-local" required></label><div class="form-grid"><label class="field"><span>Duração (minutos)</span><input name="durationMinutes" type="number" value="60"></label><label class="field"><span>Presença mínima (%)</span><input name="minimumPercent" type="number" value="${state.data.settings.live_minimum_percent}"></label></div><label class="field"><span>URL da sala</span><input name="roomUrl" value="${escapeHTML(state.data.settings.live_room_url)}"></label></form>`, footer: '<button class="btn btn--outline" data-action="close-modal">Cancelar</button><button class="btn btn--primary" type="submit" form="live-class-form">Agendar</button>' });
  }

  async function saveLiveClass(form) {
    const raw = Object.fromEntries(new FormData(form));
    const values = { ...raw, startsAt: new Date(raw.startsAt).toISOString(), durationMinutes: Number(raw.durationMinutes), minimumPercent: Number(raw.minimumPercent) };
    try {
      if (state.mode === 'server') {
        const payload = await api('/api/teacher/live-classes', { method: 'POST', body: JSON.stringify(values) });
        state.data = payload.dashboard;
      } else {
        const db = getDemoDB();
        db.liveClasses.push({ id: db.counters.live++, title: values.title, starts_at: values.startsAt, duration_minutes: values.durationMinutes, minimum_percent: values.minimumPercent, room_url: values.roomUrl, status: 'scheduled', created_at: new Date().toISOString() });
        saveDemoDB(db); state.data = demoTeacherDashboard();
      }
      closeModal(); navigate('live'); toast('Aula agendada');
    } catch (error) { toast('Erro ao agendar', error.message, 'error'); }
  }

  function modalNewLiveQuestion(liveId) {
    openModal({ title: 'Criar pergunta ao vivo', body: `<form id="live-question-form" data-live-id="${liveId}" class="form-stack"><label class="field"><span>Pergunta</span><textarea name="prompt" required></textarea></label><label class="field"><span>Resposta correta</span><input name="correctAnswer"></label><div class="form-grid"><label class="field"><span>Tipo de resposta</span><select name="responseType"><option value="text">Texto</option><option value="audio">Áudio</option></select></label><label class="field"><span>Tempo para responder</span><input name="timeLimitSeconds" type="number" value="60" min="10" max="600"></label></div></form>`, footer: '<button class="btn btn--outline" data-action="close-modal">Cancelar</button><button class="btn btn--primary" type="submit" form="live-question-form">Criar pergunta</button>' });
  }

  async function saveLiveQuestion(form) {
    const values = Object.fromEntries(new FormData(form));
    const liveId = Number(form.dataset.liveId);
    try {
      if (state.mode === 'server') await api(`/api/teacher/live/${liveId}/questions`, { method: 'POST', body: JSON.stringify(values) });
      else {
        const db = getDemoDB();
        db.liveQuestions.push({ id: db.counters.question++, live_class_id: liveId, prompt: values.prompt, correct_answer: values.correctAnswer, response_type: values.responseType, time_limit_seconds: Number(values.timeLimitSeconds), published: false, answers_released: false, selected_student_id: null, created_at: new Date().toISOString() });
        saveDemoDB(db);
      }
      closeModal(); renderLiveClass(); toast('Pergunta criada');
    } catch (error) { toast('Erro ao criar pergunta', error.message, 'error'); }
  }

  async function toggleQuestion(questionId, field) {
    try {
      if (state.mode === 'server') {
        const questions = await loadLiveQuestions(Number($('.live-panel')?.dataset.liveId));
        const question = questions.find((item) => item.id === questionId);
        await api(`/api/teacher/live/questions/${questionId}`, { method: 'PUT', body: JSON.stringify(field === 'published' ? { published: !question.published } : { answersReleased: true }) });
      } else {
        const db = getDemoDB();
        const question = db.liveQuestions.find((item) => item.id === questionId);
        if (field === 'published') {
          db.liveQuestions.filter((item) => item.live_class_id === question.live_class_id).forEach((item) => { item.published = false; });
          question.published = !question.published;
        } else question.answers_released = true;
        saveDemoDB(db);
      }
      renderLiveClass();
    } catch (error) { toast('Erro na pergunta', error.message, 'error'); }
  }

  async function showLiveAnswers(questionId) {
    let answers;
    if (state.mode === 'server') answers = (await api(`/api/teacher/live/questions/${questionId}/answers`)).answers;
    else {
      const db = getDemoDB();
      answers = db.liveAnswers.filter((answer) => answer.question_id === questionId).map((answer) => ({ ...answer, student_name: db.users.find((user) => user.id === answer.student_id)?.name, student_email: db.users.find((user) => user.id === answer.student_id)?.email }));
    }
    const students = state.data.students || [];
    openModal({
      title: 'Respostas dos alunos',
      subtitle: 'As respostas ficam privadas até você liberar.',
      wide: true,
      body: `<div class="answer-list">${answers.length ? answers.map((answer) => `<article class="answer-item"><strong>${escapeHTML(answer.student_name)}</strong>${answer.audio_url ? `<audio controls src="${escapeHTML(answer.audio_url)}"></audio>` : `<p>${escapeHTML(answer.answer_text)}</p>`}<button class="btn btn--quiet" style="margin-top:8px" data-action="select-speaking-student" data-question-id="${questionId}" data-student-id="${answer.student_id}">Escolher para falar</button></article>`).join('') : emptyState('…', 'Aguardando respostas', 'Nenhum aluno respondeu ainda.')}</div><div class="section-heading" style="margin-top:20px"><div><h3>Escolher outro aluno</h3></div></div><select id="speaking-student-select">${students.map((student) => `<option value="${student.id}">${escapeHTML(student.name)}</option>`).join('')}</select>`,
      footer: `<button class="btn btn--outline" data-action="close-modal">Fechar</button><button class="btn btn--primary" data-action="select-speaking-from-list" data-question-id="${questionId}">Escolher aluno</button>`
    });
  }

  async function selectSpeakingStudent(questionId, studentId) {
    try {
      if (state.mode === 'server') await api(`/api/teacher/live/questions/${questionId}`, { method: 'PUT', body: JSON.stringify({ selectedStudentId: Number(studentId) }) });
      else {
        const db = getDemoDB();
        db.liveQuestions.find((question) => question.id === Number(questionId)).selected_student_id = Number(studentId);
        saveDemoDB(db);
      }
      closeModal(); renderLiveClass(); toast('Aluno selecionado');
    } catch (error) { toast('Erro ao selecionar', error.message, 'error'); }
  }

  async function updateStudentAction(action, studentId) {
    const student = state.data.students.find((item) => item.id === Number(studentId));
    if (!student) return;
    try {
      if (action === 'edit') return modalNewStudent(student);
      if (action === 'delete' && !confirm(`Remover ${student.name}?`)) return;
      if (state.mode === 'server') {
        let payload;
        if (action === 'delete') payload = await api(`/api/teacher/students/${student.id}`, { method: 'DELETE' });
        else if (action === 'new-link') payload = await api(`/api/teacher/students/${student.id}/new-link`, { method: 'POST', body: '{}' });
        else payload = await api(`/api/teacher/students/${student.id}`, { method: 'PUT', body: JSON.stringify({ blocked: !student.blocked }) });
        state.data = payload.dashboard;
      } else {
        const db = getDemoDB();
        const target = db.users.find((user) => user.id === student.id);
        if (action === 'delete') db.users = db.users.filter((user) => user.id !== student.id);
        else if (action === 'new-link') target.access_token = `student-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
        else target.blocked = !target.blocked;
        saveDemoDB(db); state.data = demoTeacherDashboard();
      }
      renderStudents(); renderShell(); toast('Cadastro atualizado');
    } catch (error) { toast('Erro no cadastro', error.message, 'error'); }
  }

  async function deleteUnit(unitId) {
    if (!confirm('Remover esta unidade e todo o conteúdo dentro dela?')) return;
    try {
      if (state.mode === 'server') state.data = (await api(`/api/teacher/units/${unitId}`, { method: 'DELETE' })).dashboard;
      else {
        const db = getDemoDB(); db.units = db.units.filter((unit) => unit.id !== Number(unitId)); saveDemoDB(db); state.data = demoTeacherDashboard();
      }
      renderBuilder(); renderShell();
    } catch (error) { toast('Erro ao remover', error.message, 'error'); }
  }

  async function updateAbsence(absenceId, action) {
    try {
      if (state.mode === 'server') {
        const absence = state.data.absences.find((item) => item.id === Number(absenceId));
        state.data = action === 'delete'
          ? (await api(`/api/teacher/absences/${absenceId}`, { method: 'DELETE' })).dashboard
          : (await api(`/api/teacher/absences/${absenceId}`, { method: 'PUT', body: JSON.stringify({ justified: !absence.justified }) })).dashboard;
      } else {
        const db = getDemoDB();
        if (action === 'delete') db.absences = db.absences.filter((absence) => absence.id !== Number(absenceId));
        else {
          const absence = db.absences.find((item) => item.id === Number(absenceId)); absence.justified = !absence.justified;
        }
        saveDemoDB(db); state.data = demoTeacherDashboard();
      }
      renderAttendance(); renderShell();
    } catch (error) { toast('Erro na falta', error.message, 'error'); }
  }

  async function saveSettings(form) {
    const values = Object.fromEntries(new FormData(form));
    values.contentProtection = values.contentProtection === '1';
    try {
      if (state.mode === 'server') state.data = (await api('/api/teacher/settings', { method: 'PUT', body: JSON.stringify(values) })).dashboard;
      else {
        const db = getDemoDB();
        Object.assign(db.settings, { school_name: values.schoolName, course_name: values.courseName, weekly_minimum_percent: Number(values.weeklyMinimumPercent), live_minimum_percent: Number(values.liveMinimumPercent), live_room_url: values.liveRoomUrl, timezone: values.timezone, content_protection: values.contentProtection });
        saveDemoDB(db); state.data = demoTeacherDashboard();
      }
      renderSettings(); toast('Configurações salvas');
    } catch (error) { toast('Erro ao salvar', error.message, 'error'); }
  }

  function setupEventDelegation() {
    document.addEventListener('click', async (event) => {
      const pageButton = event.target.closest('[data-page]');
      if (pageButton) return navigate(pageButton.dataset.page);
      const actionButton = event.target.closest('[data-action]');
      const openActivityButton = event.target.closest('[data-open-activity]');
      const openUnitButton = event.target.closest('[data-open-unit]');
      const openLessonButton = event.target.closest('[data-open-lesson]');
      const reportButton = event.target.closest('[data-report-student]');
      const optionButton = event.target.closest('[data-select-option]');
      const speakButton = event.target.closest('[data-speak]');
      if (openActivityButton) {
        const found = findActivity(Number(openActivityButton.dataset.openActivity));
        state.activeActivityId = found?.activity.id;
        return navigate(found?.activity.type === 'pronunciation' ? 'pronunciation' : 'writing', { activityId: state.activeActivityId });
      }
      if (openUnitButton) {
        state.activeUnitId = Number(openUnitButton.dataset.openUnit);
        renderUnits();
        setTimeout(() => $('#unit-lessons')?.scrollIntoView({ behavior: 'smooth' }), 50);
        return;
      }
      if (openLessonButton) return navigate('units', { lessonId: Number(openLessonButton.dataset.openLesson) });
      if (event.target.closest('[data-back-units]')) { state.activeLessonId = null; return navigate('units'); }
      if (reportButton) return navigate('reports', { studentId: Number(reportButton.dataset.reportStudent) });
      if (optionButton) {
        $$('.option-button').forEach((button) => button.classList.remove('is-selected'));
        optionButton.classList.add('is-selected');
        $('#activity-answer').value = optionButton.dataset.selectOption;
        return;
      }
      if (speakButton) {
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(speakButton.dataset.speak);
        utterance.lang = 'en-US'; utterance.rate = .84;
        speechSynthesis.speak(utterance);
        return;
      }
      if (!actionButton) return;
      const action = actionButton.dataset.action;
      if (action === 'close-modal') return closeModal();
      if (action === 'new-student') return modalNewStudent();
      if (action === 'edit-student') return updateStudentAction('edit', actionButton.dataset.studentId);
      if (action === 'toggle-student') return updateStudentAction('toggle', actionButton.dataset.studentId);
      if (action === 'new-link') return updateStudentAction('new-link', actionButton.dataset.studentId);
      if (action === 'delete-student') return updateStudentAction('delete', actionButton.dataset.studentId);
      if (action === 'copy-link') {
        const student = state.data.students.find((item) => item.id === Number(actionButton.dataset.studentId));
        await navigator.clipboard.writeText(studentLink(student.access_token));
        return toast('Link copiado', student.email);
      }
      if (action === 'copy-all-links') {
        const text = state.data.students.map((student) => `${student.name}: ${studentLink(student.access_token)}`).join('\n');
        await navigator.clipboard.writeText(text); return toast('Links copiados', 'A lista da turma foi copiada.');
      }
      if (action === 'new-unit') return modalNewUnit();
      if (action === 'edit-unit') return modalNewUnit(state.data.units.find((unit) => unit.id === Number(actionButton.dataset.unitId)));
      if (action === 'delete-unit') return deleteUnit(Number(actionButton.dataset.unitId));
      if (action === 'new-lesson') return modalNewLesson();
      if (action === 'new-activity') return modalNewActivity(actionButton.dataset.lessonId || '');
      if (action === 'view-lesson') return navigate('units', { lessonId: Number(actionButton.dataset.lessonId) });
      if (action === 'new-notice') return modalNewNotice();
      if (action === 'new-live-class') return modalNewLiveClass();
      if (action === 'new-live-question') return modalNewLiveQuestion(Number(actionButton.dataset.liveId));
      if (action === 'publish-question') return toggleQuestion(Number(actionButton.dataset.questionId), 'published');
      if (action === 'release-answers') return toggleQuestion(Number(actionButton.dataset.questionId), 'answers');
      if (action === 'view-live-answers') return showLiveAnswers(Number(actionButton.dataset.questionId));
      if (action === 'select-speaking-student') return selectSpeakingStudent(Number(actionButton.dataset.questionId), Number(actionButton.dataset.studentId));
      if (action === 'select-speaking-from-list') return selectSpeakingStudent(Number(actionButton.dataset.questionId), Number($('#speaking-student-select').value));
      if (action === 'justify-absence') return updateAbsence(Number(actionButton.dataset.absenceId), 'justify');
      if (action === 'delete-absence') return updateAbsence(Number(actionButton.dataset.absenceId), 'delete');
      if (action === 'print-report') return window.print();
      if (action === 'load-full-report') return showFullReport(Number(actionButton.dataset.studentId));
    });

    document.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (event.target.id === 'login-form') return handleLogin(event);
      if (event.target.id === 'activity-form') return submitActivity(event.target);
      if (event.target.id === 'live-answer-form') return submitLiveAnswer(event.target);
      if (event.target.id === 'student-form') return saveStudent(event.target);
      if (event.target.id === 'unit-form') return saveUnit(event.target);
      if (event.target.id === 'lesson-form') return saveLesson(event.target);
      if (event.target.id === 'activity-create-form') return saveActivity(event.target);
      if (event.target.id === 'notice-form') return saveNotice(event.target);
      if (event.target.id === 'live-class-form') return saveLiveClass(event.target);
      if (event.target.id === 'live-question-form') return saveLiveQuestion(event.target);
      if (event.target.id === 'settings-form') return saveSettings(event.target);
    });

    document.addEventListener('input', (event) => {
      if (event.target.id === 'student-search') {
        const query = event.target.value.trim().toLowerCase();
        $$('[data-student-row]').forEach((row) => row.classList.toggle('is-hidden', !row.dataset.search.includes(query)));
      }
    });

    document.addEventListener('click', (event) => {
      if (event.target.id === 'content-protection-switch' || event.target.id === 'activity-required-switch') {
        const button = event.target;
        button.classList.toggle('is-on');
        const hidden = button.parentElement.querySelector('input[type="hidden"]');
        if (hidden) hidden.value = button.classList.contains('is-on') ? '1' : '0';
      }
    });
  }

  async function showFullReport(studentId) {
    try {
      const dashboard = state.mode === 'server' ? await api(`/api/teacher/reports/${studentId}`) : demoStudentDashboard(studentId);
      openModal({
        title: `Relatório de ${dashboard.student.name}`,
        subtitle: `${dashboard.summary.progress}% concluído · nota ${dashboard.summary.grade}`,
        wide: true,
        body: `<div class="stats-grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">${statCard('Progresso', `${dashboard.summary.progress}%`, 'do curso')}${statCard('Nota', `${dashboard.summary.grade}`, 'de 10')}${statCard('Concluídas', `${dashboard.summary.completed}`, `de ${dashboard.summary.total}`)}${statCard('Faltas', `${dashboard.summary.absences}`, 'não justificadas')}</div><div class="section-heading"><div><h3>Tentativas recentes</h3></div></div><div class="list">${dashboard.attempts.slice(0, 10).map((attempt) => `<article class="list-item"><div class="list-item__main"><span class="list-item__icon">${attempt.correct ? '✓' : '!'}</span><div class="list-item__copy"><strong>${escapeHTML(attempt.activity_title)}</strong><span>${escapeHTML(attempt.feedback)}</span></div></div>${statusBadge(`Nota ${attempt.score}`, attempt.correct ? 'success' : 'warning')}</article>`).join('') || '<p class="muted">Sem tentativas.</p>'}</div>`,
        footer: '<button class="btn btn--outline" data-action="close-modal">Fechar</button><button class="btn btn--primary" onclick="window.print()">Imprimir</button>'
      });
    } catch (error) { toast('Erro no relatório', error.message, 'error'); }
  }

  function bindStaticEvents() {
    elements.togglePassword.addEventListener('click', () => {
      const visible = elements.loginPassword.type === 'text';
      elements.loginPassword.type = visible ? 'password' : 'text';
      elements.togglePassword.textContent = visible ? 'Mostrar' : 'Ocultar';
    });
    elements.fillDemo.addEventListener('click', () => {
      if (state.accessToken) {
        elements.loginEmail.value = 'ana@vanguard.demo';
        elements.loginPassword.value = 'Aluno123';
      } else {
        elements.loginEmail.value = 'professor@vanguard.demo';
        elements.loginPassword.value = 'Professor123';
      }
    });
    elements.logoutButton.addEventListener('click', logout);
    elements.mobileMenu.addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
    elements.notificationButton.addEventListener('click', () => navigate('notices'));
    elements.modalRoot.addEventListener('click', (event) => { if (event.target === elements.modalRoot) closeModal(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal(); });
    document.addEventListener('contextmenu', (event) => { if (document.body.classList.contains('protected-content') && !event.target.closest('input,textarea')) event.preventDefault(); });
    document.addEventListener('copy', (event) => { if (document.body.classList.contains('protected-content') && !event.target.closest('input,textarea')) { event.preventDefault(); toast('Conteúdo protegido', 'A cópia deste material foi bloqueada.', 'error'); } });
  }

  function cacheElements() {
    Object.assign(elements, {
      boot: $('#boot'),
      loginView: $('#login-view'),
      platformView: $('#platform-view'),
      environmentBadge: $('#environment-badge'),
      loginEyebrow: $('#login-eyebrow'),
      loginTitle: $('#login-title'),
      loginCopy: $('#login-copy'),
      loginForm: $('#login-form'),
      loginEmail: $('#login-email'),
      loginPassword: $('#login-password'),
      loginFeedback: $('#login-feedback'),
      togglePassword: $('#toggle-password'),
      fillDemo: $('#fill-demo'),
      demoLabel: $('#demo-label'),
      demoCredentials: $('#demo-credentials'),
      studentLinkNote: $('#student-link-note'),
      mainNav: $('#main-nav'),
      sidebarUser: $('#sidebar-user'),
      topbarUser: $('#topbar-user'),
      noticeCount: $('#notice-count'),
      pageTitle: $('#page-title'),
      pageKicker: $('#page-kicker'),
      content: $('#content'),
      logoutButton: $('#logout-button'),
      mobileMenu: $('#mobile-menu'),
      notificationButton: $('#notification-button'),
      modalRoot: $('#modal-root'),
      toastRoot: $('#toast-root'),
      watermark: $('#watermark')
    });
  }

  async function init() {
    cacheElements();
    bindStaticEvents();
    setupEventDelegation();
    setupSessionWatcher();
    await checkEnvironment();
    await validateAccessToken();
    const restored = await restoreSession();
    if (!restored) showLogin();
    setTimeout(() => elements.boot.classList.add('is-done'), 950);
  }

  return { init, state };
})();

document.addEventListener('DOMContentLoaded', VanguardApp.init);
