(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const authScreen = $('#auth-screen');
  const appScreen = $('#app-screen');
  const view = $('#view');
  const navigation = $('#navigation');
  const modalRoot = $('#modal-root');
  const toastRoot = $('#toast-root');

  const state = {
    user: null,
    settings: {},
    token: new URLSearchParams(location.search).get('token') || '',
    route: '',
    routeData: {},
    interval: null,
    heartbeat: null,
    mediaRecorder: null,
    mediaChunks: [],
    transcript: ''
  };

  const studentMenu = [
    { section: 'Meu curso' },
    { route: 'home', icon: '⌂', label: 'Página inicial' },
    { route: 'week', icon: '✓', label: 'Atividades da semana' },
    { route: 'units', icon: '▤', label: 'Unidades e aulas' },
    { route: 'live', icon: '●', label: 'Aula ao vivo' },
    { section: 'Acompanhamento' },
    { route: 'progress', icon: '↗', label: 'Progresso, notas e faltas' },
    { route: 'notices', icon: '!', label: 'Avisos' },
    { route: 'profile', icon: '☺', label: 'Meu perfil' }
  ];

  const teacherMenu = [
    { section: 'Administração' },
    { route: 'teacher-dashboard', icon: '⌂', label: 'Painel inicial' },
    { route: 'students', icon: '♟', label: 'Cadastro de alunos' },
    { route: 'builder', icon: '+', label: 'Aulas e atividades' },
    { route: 'teacher-live', icon: '●', label: 'Aula ao vivo' },
    { route: 'attendance', icon: '✓', label: 'Presenças e faltas' },
    { route: 'reports', icon: '▤', label: 'Relatórios' },
    { route: 'settings', icon: '⚙', label: 'Configurações' }
  ];

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function formatDate(value, includeTime = true) {
    if (!value) return 'Não definido';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('pt-BR', includeTime
      ? { dateStyle: 'short', timeStyle: 'short' }
      : { dateStyle: 'short' }).format(date);
  }

  function initials(name = 'V') {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  }

  function typeLabel(type) {
    return ({
      multiple_choice: 'Alternativas',
      fill_blank: 'Completar frase',
      writing: 'Escrita',
      listening: 'Escuta',
      pronunciation: 'Pronúncia'
    })[type] || type;
  }

  function activityIcon(type) {
    return ({ multiple_choice: 'A', fill_blank: '…', writing: '✎', listening: '♫', pronunciation: '♬' })[type] || '✓';
  }

  async function api(url, options = {}) {
    const config = { credentials: 'same-origin', ...options, headers: { ...(options.headers || {}) } };
    if (options.body && !(options.body instanceof FormData) && typeof options.body !== 'string') {
      config.headers['Content-Type'] = 'application/json';
      config.body = JSON.stringify(options.body);
    }
    const response = await fetch(url, config);
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(data.error || 'Não foi possível concluir a operação.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function toast(message, type = 'success') {
    const element = document.createElement('div');
    element.className = `toast ${type === 'error' ? 'error' : ''}`;
    element.textContent = message;
    toastRoot.appendChild(element);
    setTimeout(() => element.remove(), 3800);
  }

  function setPage(title, kicker = 'Vanguard English School') {
    $('#page-title').textContent = title;
    $('#page-kicker').textContent = kicker;
    document.title = `${title} | Vanguard English School`;
  }

  function loading(text = 'Carregando...') {
    view.innerHTML = `<div class="loader"><div><strong>${escapeHtml(text)}</strong><p>Aguarde um instante.</p></div></div>`;
  }

  function empty(title, text, action = '') {
    return `<div class="empty-state"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p>${action}</div></div>`;
  }

  function modal(title, body, footer = '', wide = false) {
    modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? 'wide' : ''}"><header class="modal-header"><h3>${escapeHtml(title)}</h3><button class="modal-close" type="button">×</button></header><div class="modal-body">${body}</div>${footer ? `<footer class="modal-footer">${footer}</footer>` : ''}</section></div>`;
    const close = () => { modalRoot.innerHTML = ''; };
    $('.modal-close', modalRoot).onclick = close;
    $('.modal-backdrop', modalRoot).onclick = event => { if (event.target === event.currentTarget) close(); };
    return close;
  }

  function stopTimers() {
    clearInterval(state.interval);
    clearInterval(state.heartbeat);
    state.interval = null;
    state.heartbeat = null;
    if (state.mediaRecorder?.state === 'recording') state.mediaRecorder.stop();
  }

  function showLogin(token = '') {
    state.token = token;
    appScreen.classList.add('hidden');
    authScreen.classList.remove('hidden');
    const student = Boolean(token);
    $('#login-kicker').textContent = student ? 'Link individual protegido' : 'Área do professor';
    $('#login-title').textContent = student ? 'Área do aluno' : 'Bem-vindo de volta';
    $('#login-description').textContent = student
      ? 'Entre com o e-mail cadastrado para este link. Outro e-mail não terá acesso.'
      : 'Entre para administrar alunos, aulas e relatórios.';
    $('#demo-title').textContent = student ? 'Demonstração da aluna Ana' : 'Conta de demonstração do professor';
    $('#demo-email').textContent = student ? 'ana@vanguard.demo' : 'professor@vanguard.demo';
    $('#demo-password').textContent = student ? 'Senha: Aluno123' : 'Senha: Professor123';
    $('#student-demo').classList.toggle('hidden', student);
    $('#teacher-login').classList.toggle('hidden', !student);
    $('#access-help').textContent = student
      ? 'Este acesso encerra uma sessão anterior aberta em outro aparelho.'
      : 'O aluno deve entrar pelo link individual enviado pelo professor.';
    $('#login-email').value = '';
    $('#login-password').value = '';
    $('#login-message').textContent = '';
  }

  function createWatermark() {
    const layer = $('#watermark');
    layer.innerHTML = '';
    if (state.user?.role !== 'student' || Number(state.settings.content_protection) !== 1) {
      layer.classList.remove('active');
      document.body.classList.remove('protected');
      return;
    }
    layer.classList.add('active');
    document.body.classList.add('protected');
    const text = `${state.user.name} • ${state.user.email}`;
    for (let y = 0; y < innerHeight + 200; y += 150) {
      for (let x = -100; x < innerWidth + 300; x += 280) {
        const span = document.createElement('span');
        span.textContent = text;
        span.style.left = `${x}px`;
        span.style.top = `${y + ((x / 280) % 2) * 50}px`;
        layer.appendChild(span);
      }
    }
  }

  function enableProtection() {
    createWatermark();
    if (state.user?.role !== 'student' || Number(state.settings.content_protection) !== 1) return;
    document.oncontextmenu = event => {
      if (!event.target.closest('input,textarea,select')) event.preventDefault();
    };
    document.oncopy = event => {
      if (!event.target.closest('input,textarea')) {
        event.preventDefault();
        toast('A cópia do conteúdo está bloqueada nesta área.', 'error');
      }
    };
    document.onkeydown = event => {
      if ((event.ctrlKey || event.metaKey) && ['c', 'u', 's', 'p'].includes(event.key.toLowerCase()) && !event.target.closest('input,textarea')) {
        event.preventDefault();
        toast('Esta ação foi bloqueada para proteger o conteúdo.', 'error');
      }
    };
  }

  function renderNavigation() {
    const items = state.user.role === 'teacher' ? teacherMenu : studentMenu;
    navigation.innerHTML = items.map(item => item.section
      ? `<div class="nav-label">${escapeHtml(item.section)}</div>`
      : `<button class="nav-item ${item.route === state.route ? 'active' : ''}" data-route="${item.route}" type="button"><span class="icon">${item.icon}</span>${escapeHtml(item.label)}</button>`
    ).join('');
    $$('.nav-item', navigation).forEach(button => button.onclick = () => navigate(button.dataset.route));
  }

  function showApp() {
    authScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    const short = state.user.name.split(' ')[0];
    $('#side-name').textContent = state.user.name;
    $('#side-role').textContent = state.user.role === 'teacher' ? 'Professor' : 'Aluno';
    $('#side-avatar').textContent = initials(state.user.name);
    $('#top-avatar').textContent = initials(state.user.name);
    $('#top-name').textContent = short;
    enableProtection();
    const hash = location.hash.replace('#', '');
    const defaultRoute = state.user.role === 'teacher' ? 'teacher-dashboard' : 'home';
    navigate(hash || defaultRoute, {}, true);
  }

  async function navigate(route, data = {}, force = false) {
    stopTimers();
    state.route = route;
    state.routeData = data;
    if (!force && location.hash !== `#${route}`) history.pushState(null, '', `#${route}`);
    renderNavigation();
    $('#sidebar').classList.remove('open');
    $('#menu-backdrop').classList.remove('active');
    loading();
    try {
      const handlers = state.user.role === 'teacher' ? teacherRoutes : studentRoutes;
      if (!handlers[route]) throw new Error('Tela não encontrada.');
      await handlers[route](data);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      console.error(error);
      if (error.status === 401) {
        state.user = null;
        showLogin(state.token);
        toast(error.message, 'error');
        return;
      }
      view.innerHTML = empty('Não foi possível abrir esta tela', error.message, `<button id="retry" class="button primary">Tentar novamente</button>`);
      $('#retry')?.addEventListener('click', () => navigate(route, data, true));
    }
  }

  function activityRow(activity) {
    const done = Boolean(activity.submitted_at);
    return `<article class="list-item">
      <div class="list-main"><span class="list-icon">${activityIcon(activity.type)}</span><div><h4>${escapeHtml(activity.title)}</h4><p>${escapeHtml(activity.unit_title || '')}${activity.lesson_title ? ` • ${escapeHtml(activity.lesson_title)}` : ''}</p><small>${typeLabel(activity.type)} • prazo ${formatDate(activity.deadline)}</small></div></div>
      <div class="actions"><span class="badge ${done ? '' : 'orange'}">${done ? `Concluída • ${Number(activity.score || 0).toFixed(1)}` : 'Pendente'}</span><button class="button ${done ? 'ghost' : 'primary'}" data-activity="${activity.id}">${done ? 'Revisar' : 'Fazer'}</button></div>
    </article>`;
  }

  function bindActivityButtons() {
    $$('[data-activity]').forEach(button => button.onclick = () => openActivity(Number(button.dataset.activity)));
  }

  async function findActivity(id) {
    const week = await api('/api/student/week');
    let activity = week.activities.find(item => Number(item.id) === Number(id));
    if (activity) return activity;
    const units = await api('/api/student/units');
    for (const unit of units.units) {
      const detail = await api(`/api/student/units/${unit.id}`);
      for (const lesson of detail.lessons) {
        activity = lesson.activities.find(item => Number(item.id) === Number(id));
        if (activity) return { ...activity, lesson_title: lesson.title, unit_title: detail.unit.title };
      }
    }
    throw new Error('Atividade não encontrada.');
  }

  async function openActivity(id) {
    stopTimers();
    state.route = 'activity';
    renderNavigation();
    loading('Abrindo atividade...');
    const activity = await findActivity(id);
    setPage(activity.type === 'pronunciation' ? 'Atividade de pronúncia' : 'Atividade escrita', activity.unit_title || 'Atividade');
    renderActivity(activity);
  }

  function renderActivity(activity) {
    const options = Array.isArray(activity.options) ? activity.options : [];
    let control = '';
    if (activity.type === 'multiple_choice') {
      control = `<div class="option-list">${options.map((option, index) => `<label class="option"><input type="radio" name="answer" value="${escapeHtml(option)}"> <span>${escapeHtml(option)}</span></label>`).join('')}</div>`;
    } else if (activity.type === 'pronunciation') {
      control = `<div class="pronunciation-box"><span class="eyebrow dark">Leia em voz alta</span><div class="phrase">${escapeHtml(activity.pronunciation_target || activity.correct_answer || activity.prompt)}</div><button id="pronunciation-mic" class="mic-button" type="button">🎙</button><p id="record-status" class="muted">Clique para gravar. O navegador também tentará reconhecer a frase.</p><div id="recognized-text"></div></div>`;
    } else {
      control = `${activity.media_url ? `<audio controls src="${escapeHtml(activity.media_url)}"></audio>` : ''}<label class="field"><span>Sua resposta</span><textarea id="activity-answer" placeholder="Digite sua resposta aqui..."></textarea></label>`;
    }
    view.innerHTML = `<div class="page-header"><div><h2>${escapeHtml(activity.title)}</h2><p>${typeLabel(activity.type)} • vale ${activity.points} pontos</p></div><button id="back-week" class="button ghost">← Voltar</button></div>
      <section class="card activity-card"><span class="badge">${typeLabel(activity.type)}</span><h3 style="margin-top:16px">${escapeHtml(activity.prompt)}</h3>${control}<div id="activity-feedback"></div><div class="actions" style="margin-top:20px"><button id="submit-activity" class="button primary">Enviar resposta</button></div></section>`;
    $('#back-week').onclick = () => navigate('week');
    let recordedBlob = null;
    if (activity.type === 'pronunciation') {
      $('#pronunciation-mic').onclick = async () => {
        if (state.mediaRecorder?.state === 'recording') {
          state.mediaRecorder.stop();
          return;
        }
        try {
          state.transcript = '';
          recordedBlob = null;
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          state.mediaChunks = [];
          state.mediaRecorder = new MediaRecorder(stream);
          state.mediaRecorder.ondataavailable = event => { if (event.data.size) state.mediaChunks.push(event.data); };
          state.mediaRecorder.onstop = () => {
            recordedBlob = new Blob(state.mediaChunks, { type: state.mediaRecorder.mimeType || 'audio/webm' });
            stream.getTracks().forEach(track => track.stop());
            $('#pronunciation-mic').classList.remove('recording');
            $('#record-status').textContent = 'Gravação concluída. Agora envie a resposta.';
          };
          const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
          if (Recognition) {
            const recognition = new Recognition();
            recognition.lang = 'en-US';
            recognition.interimResults = false;
            recognition.onresult = event => {
              state.transcript = event.results[0][0].transcript;
              $('#recognized-text').innerHTML = `<div class="feedback">O navegador reconheceu: “${escapeHtml(state.transcript)}”</div>`;
            };
            recognition.onerror = () => {};
            recognition.start();
          }
          state.mediaRecorder.start();
          $('#pronunciation-mic').classList.add('recording');
          $('#record-status').textContent = 'Gravando... clique novamente para parar.';
          setTimeout(() => { if (state.mediaRecorder?.state === 'recording') state.mediaRecorder.stop(); }, 9000);
        } catch {
          toast('Permita o uso do microfone no navegador.', 'error');
        }
      };
    }
    $('#submit-activity').onclick = async () => {
      try {
        const form = new FormData();
        let answer = '';
        if (activity.type === 'multiple_choice') answer = $('input[name="answer"]:checked')?.value || '';
        else if (activity.type === 'pronunciation') answer = state.transcript;
        else answer = $('#activity-answer')?.value.trim() || '';
        if (!answer && !recordedBlob) return toast('Responda a atividade antes de enviar.', 'error');
        form.append('answer', answer);
        form.append('transcript', state.transcript || answer);
        if (recordedBlob) form.append('audio', recordedBlob, 'pronuncia.webm');
        const result = await api(`/api/student/activities/${activity.id}/submit`, { method: 'POST', body: form });
        $('#activity-feedback').innerHTML = `<div class="feedback ${result.isCorrect ? '' : 'error'}"><strong>${result.isCorrect ? 'Resposta correta!' : 'Confira novamente'}</strong><br>${escapeHtml(result.feedback)}<br>Nota: ${Number(result.score).toFixed(1)}</div>`;
        toast('Atividade salva.');
      } catch (error) { toast(error.message, 'error'); }
    };
  }

  const studentRoutes = {
    async home() {
      setPage('Página inicial', 'Área do aluno');
      const data = await api('/api/student/dashboard');
      view.innerHTML = `<div class="page-header"><div><h2>Olá, ${escapeHtml(state.user.name.split(' ')[0])}!</h2><p>Veja somente o que precisa da sua atenção esta semana.</p></div><span class="badge">${escapeHtml(data.week)}</span></div>
        <section class="grid four">
          <article class="card stat-card"><span class="stat-label">Progresso do curso</span><b class="stat-value">${data.stats.progress}%</b><span class="stat-note">${data.stats.completed} de ${data.stats.total} atividades</span></article>
          <article class="card stat-card"><span class="stat-label">Média das notas</span><b class="stat-value">${data.stats.grade}</b><span class="stat-note">Média das entregas</span></article>
          <article class="card stat-card"><span class="stat-label">Faltas</span><b class="stat-value">${data.stats.absences}</b><span class="stat-note">Sem justificativa</span></article>
          <article class="card stat-card"><span class="stat-label">Atividades da semana</span><b class="stat-value">${data.weekly.filter(a => !a.submitted_at).length}</b><span class="stat-note">Pendentes</span></article>
        </section>
        <div class="section-title"><h2>Atividades da semana</h2><button class="button ghost" data-go="week">Ver todas</button></div>
        <section class="list">${data.weekly.slice(0, 4).map(activityRow).join('') || empty('Tudo concluído', 'Não há atividades pendentes nesta semana.')}</section>
        <section class="grid two" style="margin-top:28px">
          <article class="card"><span class="eyebrow dark">Próxima aula ao vivo</span>${data.live ? `<h3 style="margin-top:12px">${escapeHtml(data.live.title)}</h3><p>${formatDate(data.live.starts_at)}</p><p class="muted">${escapeHtml(data.live.description || '')}</p><button class="button primary" data-go="live">Abrir aula ao vivo</button>` : '<p>Nenhuma aula agendada.</p>'}</article>
          <article class="card"><span class="eyebrow dark">Avisos do professor</span><div class="list" style="margin-top:12px">${data.notices.map(n => `<div class="notice"><strong>${escapeHtml(n.title)}</strong><p>${escapeHtml(n.message)}</p></div>`).join('') || '<p>Nenhum aviso.</p>'}</div></article>
        </section>`;
      bindActivityButtons();
      $$('[data-go]').forEach(button => button.onclick = () => navigate(button.dataset.go));
    },

    async week() {
      setPage('Atividades da semana', 'Área do aluno');
      const data = await api('/api/student/week');
      const completed = data.activities.filter(a => a.submitted_at).length;
      const percent = data.activities.length ? Math.round(completed * 100 / data.activities.length) : 0;
      view.innerHTML = `<div class="page-header"><div><h2>Atividades da semana</h2><p>Você recebe apenas uma presença online pelo conjunto obrigatório da semana.</p></div><span class="badge">${escapeHtml(data.week)}</span></div>
        <article class="card soft"><div class="section-title" style="margin:0 0 10px"><h3>${completed} de ${data.activities.length} concluídas</h3><strong>${percent}%</strong></div><div class="progress-track"><div class="progress-bar" style="width:${percent}%"></div></div></article>
        <div class="list" style="margin-top:20px">${data.activities.map(activityRow).join('') || empty('Nenhuma atividade', 'O professor ainda não publicou tarefas para esta semana.')}</div>`;
      bindActivityButtons();
    },

    async units() {
      setPage('Unidades do curso', 'Conteúdo e aulas');
      const data = await api('/api/student/units');
      view.innerHTML = `<div class="page-header"><div><h2>Unidades e aulas</h2><p>Conteúdo organizado sem menus desnecessários.</p></div></div><section class="grid two">${data.units.map(unit => `<article class="card unit-card"><span class="badge">Unidade ${unit.position}</span><h3 style="margin-top:15px">${escapeHtml(unit.title)}</h3><p class="muted">${escapeHtml(unit.description || '')}</p><button class="button primary" data-unit="${unit.id}">Abrir unidade</button></article>`).join('')}</section>`;
      $$('[data-unit]').forEach(button => button.onclick = () => studentRoutes.unit({ id: Number(button.dataset.unit) }));
    },

    async unit(data) {
      const result = await api(`/api/student/units/${data.id}`);
      setPage(result.unit.title, 'Unidade e conteúdo da aula');
      view.innerHTML = `<div class="page-header"><div><h2>${escapeHtml(result.unit.title)}</h2><p>${escapeHtml(result.unit.description || '')}</p></div><button id="back-units" class="button ghost">← Unidades</button></div>
        <div class="grid">${result.lessons.map(lesson => `<section class="card"><span class="eyebrow dark">Aula ${lesson.position}</span><h3 style="font-size:1.5rem;margin-top:12px">${escapeHtml(lesson.title)}</h3><div class="lesson-content">${escapeHtml(lesson.content || '').replace(/\n/g, '<br>')}</div>${lesson.video_url ? `<div class="media-frame" style="margin-top:18px"><iframe src="${escapeHtml(lesson.video_url)}" allowfullscreen></iframe></div>` : ''}${lesson.image_url ? `<img style="max-width:100%;border-radius:18px;margin-top:18px" src="${escapeHtml(lesson.image_url)}" alt="Imagem da aula">` : ''}${lesson.audio_url ? `<audio style="width:100%;margin-top:18px" controls src="${escapeHtml(lesson.audio_url)}"></audio>` : ''}<div class="section-title"><h3>Atividades</h3></div><div class="list">${lesson.activities.map(a => activityRow({ ...a, unit_title: result.unit.title, lesson_title: lesson.title })).join('')}</div></section>`).join('')}</div>`;
      $('#back-units').onclick = () => navigate('units');
      bindActivityButtons();
    },

    async live() {
      setPage('Aula ao vivo', 'Conversação e interação');
      let lastSignature = '';
      const render = async (force = false) => {
        const data = await api('/api/student/live');
        const signature = JSON.stringify({ live: data.live?.id, question: data.question?.id, revealed: data.question?.revealed, chosen: data.question?.chosen_student_id, answered: data.myAnswer?.id });
        if (!force && signature === lastSignature) return;
        lastSignature = signature;
        if (!data.live) {
          view.innerHTML = empty('Nenhuma aula agendada', 'O professor ainda não marcou a próxima aula ao vivo.');
          return;
        }
        await api(`/api/student/live/${data.live.id}/join`, { method: 'POST', body: {} });
        const question = data.question;
        let questionHtml = '<p class="muted">Aguardando o professor publicar uma pergunta.</p>';
        if (question) {
          const elapsed = Math.floor((Date.now() - new Date(question.created_at).getTime()) / 1000);
          const remaining = Math.max(0, Number(question.seconds_to_answer) - elapsed);
          questionHtml = `<div class="question-box"><span class="eyebrow dark">Pergunta do professor</span><h3>${escapeHtml(question.prompt)}</h3><div class="timer" data-timer="${remaining}">${remaining}s</div>${data.myAnswer ? `<div class="feedback">Sua resposta foi enviada. As respostas dos colegas continuam ocultas.</div>` : `<label class="field"><span>Sua resposta</span><textarea id="live-answer"></textarea></label><div class="actions"><button id="send-live-answer" class="button primary">Enviar por texto</button><button id="record-live-answer" class="button secondary">Gravar áudio</button></div>`}${question.chosen_student_name ? `<p><strong>Aluno escolhido para responder:</strong> ${escapeHtml(question.chosen_student_name)}</p>` : ''}${Number(question.revealed) ? `<div class="feedback"><strong>Resposta correta:</strong> ${escapeHtml(question.correct_answer || 'Resposta liberada pelo professor.')}</div>` : ''}</div>`;
        }
        view.innerHTML = `<div class="page-header"><div><h2>${escapeHtml(data.live.title)}</h2><p>${formatDate(data.live.starts_at)} • presença registrada automaticamente</p></div><span class="badge ${data.live.status === 'live' ? '' : 'orange'}">${data.live.status === 'live' ? 'Ao vivo' : 'Agendada'}</span></div><div class="live-grid"><iframe class="live-frame" src="${escapeHtml(data.live.room_url)}" allow="camera; microphone; fullscreen; display-capture"></iframe><aside class="card"><h3>Interação da aula</h3><p class="muted">As respostas dos colegas só aparecem quando o professor liberar.</p>${questionHtml}</aside></div>`;
        if (!state.heartbeat) state.heartbeat = setInterval(() => api(`/api/student/live/${data.live.id}/heartbeat`, { method: 'POST', body: {} }).catch(() => {}), 15000);
        const timer = $('[data-timer]');
        if (timer) {
          let seconds = Number(timer.dataset.timer);
          const countdown = setInterval(() => { seconds = Math.max(0, seconds - 1); timer.textContent = `${seconds}s`; if (!seconds) clearInterval(countdown); }, 1000);
        }
        let audioBlob = null;
        $('#record-live-answer')?.addEventListener('click', async event => {
          try {
            if (state.mediaRecorder?.state === 'recording') { state.mediaRecorder.stop(); return; }
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const chunks = [];
            state.mediaRecorder = new MediaRecorder(stream);
            state.mediaRecorder.ondataavailable = e => chunks.push(e.data);
            state.mediaRecorder.onstop = () => { audioBlob = new Blob(chunks, { type: 'audio/webm' }); stream.getTracks().forEach(t => t.stop()); event.target.textContent = 'Áudio gravado ✓'; };
            state.mediaRecorder.start();
            event.target.textContent = 'Parar gravação';
            setTimeout(() => { if (state.mediaRecorder?.state === 'recording') state.mediaRecorder.stop(); }, 12000);
          } catch { toast('Permita o uso do microfone.', 'error'); }
        });
        $('#send-live-answer')?.addEventListener('click', async () => {
          const form = new FormData();
          form.append('answer', $('#live-answer').value.trim());
          if (audioBlob) form.append('audio', audioBlob, 'resposta.webm');
          await api(`/api/student/questions/${question.id}/answer`, { method: 'POST', body: form });
          toast('Resposta enviada.');
          render();
        });
      };
      await render(true);
      state.interval = setInterval(() => render(false).catch(() => {}), 5000);
    },

    async progress() {
      setPage('Progresso, notas e faltas', 'Acompanhamento');
      const data = await api('/api/student/progress');
      view.innerHTML = `<div class="page-header"><div><h2>Seu acompanhamento</h2><p>Veja notas, tentativas e faltas registradas.</p></div></div>
        <section class="grid three"><article class="card stat-card"><span class="stat-label">Progresso</span><b class="stat-value">${data.stats.progress}%</b></article><article class="card stat-card"><span class="stat-label">Média</span><b class="stat-value">${data.stats.grade}</b></article><article class="card stat-card"><span class="stat-label">Faltas</span><b class="stat-value">${data.stats.absences}</b></article></section>
        <div class="section-title"><h2>Notas e tentativas</h2></div><div class="table-wrap"><table><thead><tr><th>Atividade</th><th>Tipo</th><th>Nota</th><th>Tentativas</th><th>Data</th></tr></thead><tbody>${data.submissions.map(s => `<tr><td><strong>${escapeHtml(s.activity_title)}</strong><br><small>${escapeHtml(s.unit_title)}</small></td><td>${typeLabel(s.type)}</td><td>${Number(s.score).toFixed(1)}</td><td>${s.attempts}</td><td>${formatDate(s.submitted_at)}</td></tr>`).join('') || '<tr><td colspan="5">Nenhuma entrega.</td></tr>'}</tbody></table></div>
        <div class="section-title"><h2>Faltas</h2></div><div class="list">${data.absences.map(a => `<article class="list-item"><div><strong>${a.kind === 'live' ? 'Falta na aula ao vivo' : 'Falta online semanal'}</strong><p>${escapeHtml(a.reason || '')}</p></div><span class="badge ${Number(a.justified) ? '' : 'red'}">${Number(a.justified) ? 'Justificada' : 'Não justificada'}</span></article>`).join('') || '<div class="card"><p>Nenhuma falta registrada.</p></div>'}</div>`;
    },

    async notices() {
      setPage('Avisos', 'Mensagens do professor');
      const data = await api('/api/student/notices');
      view.innerHTML = `<div class="page-header"><div><h2>Avisos do professor</h2><p>Informações gerais e mensagens enviadas especialmente para você.</p></div></div><div class="grid">${data.notices.map(n => `<article class="card notice"><span class="badge">${formatDate(n.created_at)}</span><h3 style="margin-top:14px">${escapeHtml(n.title)}</h3><p>${escapeHtml(n.message)}</p></article>`).join('') || empty('Nenhum aviso', 'Você não possui mensagens no momento.')}</div>`;
    },

    async profile() {
      setPage('Perfil do aluno', 'Minha conta');
      const data = await api('/api/student/profile');
      const fullLink = `${location.origin}${data.link}`;
      view.innerHTML = `<div class="page-header"><div><h2>Meu perfil</h2><p>Seus dados e seu link individual de acesso.</p></div></div><section class="grid two"><article class="card"><form id="profile-form" class="form-stack"><label><span>Nome</span><input name="name" value="${escapeHtml(state.user.name)}"></label><label><span>E-mail</span><input value="${escapeHtml(state.user.email)}" disabled></label><label><span>Nova senha</span><input name="password" type="password" placeholder="Deixe vazio para não alterar"></label><button class="button primary">Salvar alterações</button></form></article><article class="card soft"><span class="eyebrow dark">Link individual</span><h3 style="margin-top:12px">Acesso protegido</h3><p class="muted">Este link só funciona com o seu e-mail cadastrado.</p><input id="student-link" readonly value="${escapeHtml(fullLink)}"><button id="copy-link" class="button secondary" style="margin-top:12px">Copiar link</button><p class="small muted">Ao entrar em outro aparelho, a sessão anterior é encerrada.</p></article></section>`;
      $('#profile-form').onsubmit = async event => {
        event.preventDefault();
        const form = new FormData(event.target);
        await api('/api/student/profile', { method: 'PUT', body: Object.fromEntries(form) });
        toast('Perfil atualizado. Entre novamente para ver todas as alterações.');
      };
      $('#copy-link').onclick = async () => { await navigator.clipboard.writeText(fullLink); toast('Link copiado.'); };
    }
  };

  const teacherRoutes = {
    async 'teacher-dashboard'() {
      setPage('Painel inicial do professor', 'Administração');
      const data = await api('/api/teacher/dashboard');
      view.innerHTML = `<div class="page-header"><div><h2>Visão geral da turma</h2><p>Acompanhe somente os dados importantes para o curso.</p></div><button class="button primary" data-go="builder">+ Criar atividade</button></div>
        <section class="grid four"><article class="card stat-card"><span class="stat-label">Alunos ativos</span><b class="stat-value">${data.cards.students}</b></article><article class="card stat-card"><span class="stat-label">Atividades</span><b class="stat-value">${data.cards.activities}</b></article><article class="card stat-card"><span class="stat-label">Entregas</span><b class="stat-value">${data.cards.submissions}</b></article><article class="card stat-card"><span class="stat-label">Faltas pendentes</span><b class="stat-value">${data.cards.absences}</b></article></section>
        <section class="grid two" style="margin-top:24px"><article class="card"><span class="eyebrow dark">Próxima aula</span>${data.live ? `<h3 style="margin-top:12px">${escapeHtml(data.live.title)}</h3><p>${formatDate(data.live.starts_at)}</p><p class="muted">${escapeHtml(data.live.description || '')}</p><button class="button primary" data-go="teacher-live">Gerenciar aula</button>` : '<p>Nenhuma aula marcada.</p>'}</article><article class="card"><span class="eyebrow dark">Acesso rápido</span><div class="actions" style="margin-top:16px"><button class="button secondary" data-go="students">Cadastrar aluno</button><button class="button secondary" data-go="attendance">Ver faltas</button><button class="button secondary" data-go="reports">Relatórios</button></div></article></section>
        <div class="section-title"><h2>Progresso dos alunos</h2></div><div class="table-wrap"><table><thead><tr><th>Aluno</th><th>Progresso</th><th>Média</th><th>Faltas</th><th>Status</th></tr></thead><tbody>${data.students.map(s => `<tr><td><strong>${escapeHtml(s.name)}</strong><br><small>${escapeHtml(s.email)}</small></td><td><div class="progress-track"><div class="progress-bar" style="width:${s.progress}%"></div></div><small>${s.progress}%</small></td><td>${s.grade}</td><td>${s.absences}</td><td><span class="badge ${Number(s.active) ? '' : 'red'}">${Number(s.active) ? 'Ativo' : 'Bloqueado'}</span></td></tr>`).join('')}</tbody></table></div>`;
      $$('[data-go]').forEach(button => button.onclick = () => navigate(button.dataset.go));
    },

    async students() {
      setPage('Cadastro de alunos', 'Administração');
      const data = await api('/api/teacher/students');
      view.innerHTML = `<div class="page-header"><div><h2>Alunos e links individuais</h2><p>Cadastre, edite, bloqueie, remova e gere um link exclusivo.</p></div><button id="new-student" class="button primary">+ Novo aluno</button></div>
        <div class="table-wrap"><table><thead><tr><th>Aluno</th><th>Progresso</th><th>Link individual</th><th>Status</th><th>Ações</th></tr></thead><tbody>${data.students.map(s => `<tr><td><strong>${escapeHtml(s.name)}</strong><br><small>${escapeHtml(s.email)}</small></td><td>${s.progress}% • média ${s.grade}</td><td><button class="text-button" data-copy="${escapeHtml(`${location.origin}/index.html?token=${s.access_token}`)}">Copiar link</button></td><td><span class="badge ${Number(s.active) ? '' : 'red'}">${Number(s.active) ? 'Ativo' : 'Bloqueado'}</span></td><td><div class="actions"><button class="button ghost" data-edit-student="${s.id}">Editar</button><button class="button secondary" data-new-link="${s.id}">Novo link</button><button class="button danger" data-delete-student="${s.id}">Remover</button></div></td></tr>`).join('')}</tbody></table></div>`;
      $('#new-student').onclick = () => openStudentForm();
      $$('[data-copy]').forEach(button => button.onclick = async () => { await navigator.clipboard.writeText(button.dataset.copy); toast('Link copiado.'); });
      $$('[data-edit-student]').forEach(button => {
        const student = data.students.find(s => Number(s.id) === Number(button.dataset.editStudent));
        button.onclick = () => openStudentForm(student);
      });
      $$('[data-new-link]').forEach(button => button.onclick = async () => {
        if (!confirm('Gerar um novo link? O link anterior deixará de funcionar.')) return;
        const result = await api(`/api/teacher/students/${button.dataset.newLink}/new-link`, { method: 'POST', body: {} });
        await navigator.clipboard.writeText(`${location.origin}${result.link}`);
        toast('Novo link gerado e copiado.');
        navigate('students', {}, true);
      });
      $$('[data-delete-student]').forEach(button => button.onclick = async () => {
        if (!confirm('Remover este aluno e seus dados?')) return;
        await api(`/api/teacher/students/${button.dataset.deleteStudent}`, { method: 'DELETE' });
        toast('Aluno removido.');
        navigate('students', {}, true);
      });

      function openStudentForm(student = null) {
        const close = modal(student ? 'Editar aluno' : 'Cadastrar aluno', `<form id="student-form" class="form-grid"><label><span>Nome completo</span><input name="name" value="${escapeHtml(student?.name || '')}" required></label><label><span>E-mail</span><input name="email" type="email" value="${escapeHtml(student?.email || '')}" required></label><label><span>${student ? 'Nova senha (opcional)' : 'Senha inicial'}</span><input name="password" type="text" value="${student ? '' : 'Aluno123'}"></label>${student ? `<label><span>Status</span><select name="active"><option value="1" ${Number(student.active) ? 'selected' : ''}>Ativo</option><option value="0" ${!Number(student.active) ? 'selected' : ''}>Bloqueado</option></select></label>` : ''}</form>`, `<button class="button ghost modal-cancel">Cancelar</button><button class="button primary" id="save-student">Salvar</button>`);
        $('.modal-cancel').onclick = close;
        $('#save-student').onclick = async () => {
          const form = $('#student-form');
          if (!form.reportValidity()) return;
          const payload = Object.fromEntries(new FormData(form));
          if (student) {
            payload.active = payload.active === '1';
            await api(`/api/teacher/students/${student.id}`, { method: 'PUT', body: payload });
            toast('Aluno atualizado.');
          } else {
            const result = await api('/api/teacher/students', { method: 'POST', body: payload });
            const fullLink = `${location.origin}${result.link}`;
            await navigator.clipboard.writeText(fullLink);
            toast('Aluno criado. O link foi copiado.');
          }
          close();
          navigate('students', {}, true);
        };
      }
    },

    async builder() {
      setPage('Criação de aulas e atividades', 'Conteúdo do curso');
      const data = await api('/api/teacher/curriculum');
      const unitOptions = data.units.map(u => `<option value="${u.id}">${escapeHtml(u.title)}</option>`).join('');
      const lessons = data.units.flatMap(u => u.lessons.map(l => ({ ...l, unitTitle: u.title })));
      const lessonOptions = lessons.map(l => `<option value="${l.id}">${escapeHtml(l.unitTitle)} • ${escapeHtml(l.title)}</option>`).join('');
      view.innerHTML = `<div class="page-header"><div><h2>Aulas e atividades</h2><p>Crie somente o conteúdo necessário para cada unidade.</p></div><span class="badge">Semana ${escapeHtml(data.week)}</span></div>
        <section class="grid three">
          <article class="card"><span class="eyebrow dark">1. Unidade</span><form id="unit-form" class="form-stack" style="margin-top:15px"><label><span>Título</span><input name="title" required placeholder="Unit 2 — At work"></label><label><span>Descrição</span><textarea name="description"></textarea></label><button class="button primary">Criar unidade</button></form></article>
          <article class="card"><span class="eyebrow dark">2. Aula</span><form id="lesson-form" class="form-stack" style="margin-top:15px"><label><span>Unidade</span><select name="unitId" required>${unitOptions}</select></label><label><span>Título da aula</span><input name="title" required></label><label><span>Explicação escrita</span><textarea name="content"></textarea></label><label><span>URL do vídeo</span><input name="videoUrl" placeholder="https://..."></label><label><span>URL da imagem</span><input name="imageUrl" placeholder="Ou envie abaixo"></label><label><span>URL do áudio</span><input name="audioUrl" placeholder="Ou envie abaixo"></label><button class="button primary">Criar aula</button></form></article>
          <article class="card"><span class="eyebrow dark">Upload de mídia</span><form id="upload-form" class="form-stack" style="margin-top:15px"><label><span>Vídeo, imagem ou áudio</span><input name="file" type="file" required></label><button class="button secondary">Enviar arquivo</button></form><div id="upload-result"></div></article>
        </section>
        <section class="card" style="margin-top:20px"><span class="eyebrow dark">3. Atividade</span><form id="activity-form" class="form-grid" style="margin-top:15px"><label><span>Aula</span><select name="lessonId" required>${lessonOptions}</select></label><label><span>Tipo</span><select name="type"><option value="multiple_choice">Alternativas</option><option value="fill_blank">Completar frase</option><option value="writing">Escrita</option><option value="listening">Escuta</option><option value="pronunciation">Pronúncia</option></select></label><label><span>Título</span><input name="title" required></label><label><span>Prazo</span><input name="deadline" type="datetime-local"></label><label class="full"><span>Pergunta/instrução</span><textarea name="prompt" required></textarea></label><label class="full"><span>Alternativas separadas por |</span><input name="options" placeholder="Opção 1 | Opção 2 | Opção 3"></label><label><span>Resposta correta</span><input name="correctAnswer"></label><label><span>Frase de pronúncia</span><input name="pronunciationTarget"></label><label class="full"><span>Explicação para o erro</span><textarea name="explanation"></textarea></label><label><span>URL de áudio/mídia</span><input name="mediaUrl"></label><label><span>Pontos</span><input name="points" type="number" value="10"></label><label><span>Semana</span><input name="weekKey" value="${escapeHtml(data.week)}"></label><label><span>Obrigatória</span><select name="required"><option value="true">Sim</option><option value="false">Não</option></select></label><div class="full"><button class="button primary">Criar atividade</button></div></form></section>
        <div class="section-title"><h2>Conteúdo cadastrado</h2></div><div class="grid">${data.units.map(unit => `<article class="card unit-card"><h3>${escapeHtml(unit.title)}</h3><p class="muted">${escapeHtml(unit.description || '')}</p>${unit.lessons.map(lesson => `<div class="card soft" style="margin-top:12px"><strong>${escapeHtml(lesson.title)}</strong><p>${escapeHtml(lesson.content || '')}</p><div class="list">${lesson.activities.map(a => `<div class="list-item"><div class="list-main"><span class="list-icon">${activityIcon(a.type)}</span><div><h4>${escapeHtml(a.title)}</h4><small>${typeLabel(a.type)} • ${a.required ? 'obrigatória' : 'opcional'} • ${formatDate(a.deadline)}</small></div></div></div>`).join('') || '<p class="muted">Nenhuma atividade.</p>'}</div></div>`).join('')}</article>`).join('')}</div>`;

      $('#unit-form').onsubmit = async event => {
        event.preventDefault();
        await api('/api/teacher/units', { method: 'POST', body: Object.fromEntries(new FormData(event.target)) });
        toast('Unidade criada.'); navigate('builder', {}, true);
      };
      $('#lesson-form').onsubmit = async event => {
        event.preventDefault();
        await api('/api/teacher/lessons', { method: 'POST', body: Object.fromEntries(new FormData(event.target)) });
        toast('Aula criada.'); navigate('builder', {}, true);
      };
      $('#upload-form').onsubmit = async event => {
        event.preventDefault();
        const result = await api('/api/teacher/upload', { method: 'POST', body: new FormData(event.target) });
        $('#upload-result').innerHTML = `<div class="feedback">Arquivo enviado.<br><input readonly value="${escapeHtml(location.origin + result.url)}"></div>`;
        toast('Mídia enviada. Copie a URL para a aula ou atividade.');
      };
      $('#activity-form').onsubmit = async event => {
        event.preventDefault();
        const payload = Object.fromEntries(new FormData(event.target));
        payload.options = String(payload.options || '').split('|').map(v => v.trim()).filter(Boolean);
        payload.required = payload.required === 'true';
        if (payload.deadline) payload.deadline = new Date(payload.deadline).toISOString();
        await api('/api/teacher/activities', { method: 'POST', body: payload });
        toast('Atividade criada.'); navigate('builder', {}, true);
      };
    },

    async 'teacher-live'() {
      setPage('Aula ao vivo', 'Controle do professor');
      const render = async () => {
        const data = await api('/api/teacher/live');
        if (!data.live) {
          view.innerHTML = `<div class="page-header"><div><h2>Aula ao vivo</h2><p>Crie o próximo encontro da turma.</p></div></div>${liveCreateForm()}`;
          bindLiveCreate();
          return;
        }
        const answersVisible = Number(data.question?.revealed);
        view.innerHTML = `<div class="page-header"><div><h2>${escapeHtml(data.live.title)}</h2><p>${formatDate(data.live.starts_at)} • mínimo ${data.live.minimum_percent}% de participação</p></div><div class="actions"><button id="edit-live" class="button ghost">Editar</button><button id="finish-live" class="button danger">Finalizar e calcular faltas</button></div></div>
          <div class="live-grid"><iframe class="live-frame" src="${escapeHtml(data.live.room_url)}" allow="camera; microphone; fullscreen; display-capture"></iframe><aside class="card"><span class="eyebrow dark">Pergunta na tela</span>${data.question ? `<h3 style="margin-top:12px">${escapeHtml(data.question.prompt)}</h3><p>Tempo: ${data.question.seconds_to_answer}s</p><div class="actions"><button id="reveal-question" class="button ${answersVisible ? 'secondary' : 'primary'}">${answersVisible ? 'Resposta liberada' : 'Liberar respostas'}</button></div><label class="field" style="margin-top:14px"><span>Escolher aluno para falar</span><select id="chosen-student"><option value="">Nenhum</option>${data.students.map(s => `<option value="${s.id}" ${Number(data.question.chosen_student_id) === Number(s.id) ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select></label><button id="save-chosen" class="button ghost" style="margin-top:10px">Salvar escolha</button>` : '<p class="muted">Nenhuma pergunta publicada.</p>'}<hr style="border:0;border-top:1px solid var(--line);margin:22px 0"><form id="question-form" class="form-stack"><label><span>Nova pergunta</span><textarea name="prompt" required></textarea></label><label><span>Resposta correta</span><input name="correctAnswer"></label><label><span>Tempo para responder</span><input name="seconds" type="number" value="30" min="5"></label><button class="button primary">Publicar pergunta</button></form></aside></div>
          <div class="section-title"><h2>Respostas recebidas</h2><span class="badge ${answersVisible ? '' : 'orange'}">${answersVisible ? 'Liberadas' : 'Ocultas para alunos'}</span></div><div class="table-wrap"><table><thead><tr><th>Aluno</th><th>Resposta</th><th>Áudio</th><th>Horário</th></tr></thead><tbody>${data.answers.map(a => `<tr><td>${escapeHtml(a.student_name)}</td><td>${escapeHtml(a.answer_text || 'Resposta em áudio')}</td><td>${a.audio_path ? `<audio controls src="${escapeHtml(a.audio_path)}"></audio>` : '—'}</td><td>${formatDate(a.submitted_at)}</td></tr>`).join('') || '<tr><td colspan="4">Aguardando respostas.</td></tr>'}</tbody></table></div>`;
        $('#question-form').onsubmit = async event => {
          event.preventDefault();
          await api(`/api/teacher/live/${data.live.id}/questions`, { method: 'POST', body: Object.fromEntries(new FormData(event.target)) });
          toast('Pergunta publicada para os alunos.'); render();
        };
        $('#reveal-question')?.addEventListener('click', async () => {
          await api(`/api/teacher/questions/${data.question.id}`, { method: 'PUT', body: { revealed: true } });
          toast('Resposta correta e respostas liberadas.'); render();
        });
        $('#save-chosen')?.addEventListener('click', async () => {
          await api(`/api/teacher/questions/${data.question.id}`, { method: 'PUT', body: { chosenStudentId: $('#chosen-student').value || null } });
          toast('Aluno escolhido atualizado.'); render();
        });
        $('#finish-live').onclick = async () => {
          if (!confirm('Finalizar a aula e calcular as faltas ao vivo?')) return;
          await api(`/api/teacher/live/${data.live.id}`, { method: 'PUT', body: { status: 'finished' } });
          toast('Aula finalizada e presença calculada.'); navigate('attendance');
        };
        $('#edit-live').onclick = () => openLiveEdit(data.live);
      };
      await render();

      function liveCreateForm() {
        const start = new Date(Date.now() + 86400000).toISOString().slice(0,16);
        const end = new Date(Date.now() + 90000000).toISOString().slice(0,16);
        return `<section class="card"><form id="live-create-form" class="form-grid"><label><span>Título</span><input name="title" required value="Conversation Class"></label><label><span>Status</span><select name="status"><option value="scheduled">Agendada</option><option value="live">Ao vivo agora</option></select></label><label><span>Início</span><input name="startsAt" type="datetime-local" value="${start}" required></label><label><span>Fim</span><input name="endsAt" type="datetime-local" value="${end}" required></label><label><span>Participação mínima (%)</span><input name="minimumPercent" type="number" value="75"></label><label><span>Link da videochamada (opcional)</span><input name="roomUrl" placeholder="Jitsi, Meet ou outro"></label><label class="full"><span>Descrição</span><textarea name="description"></textarea></label><div class="full"><button class="button primary">Criar aula ao vivo</button></div></form></section>`;
      }
      function bindLiveCreate() {
        $('#live-create-form').onsubmit = async event => {
          event.preventDefault();
          const payload = Object.fromEntries(new FormData(event.target));
          payload.startsAt = new Date(payload.startsAt).toISOString();
          payload.endsAt = new Date(payload.endsAt).toISOString();
          await api('/api/teacher/live', { method: 'POST', body: payload });
          toast('Aula criada.'); render();
        };
      }
      function openLiveEdit(live) {
        const close = modal('Editar aula ao vivo', `<form id="live-edit-form" class="form-grid"><label><span>Título</span><input name="title" value="${escapeHtml(live.title)}"></label><label><span>Status</span><select name="status"><option value="scheduled" ${live.status === 'scheduled' ? 'selected' : ''}>Agendada</option><option value="live" ${live.status === 'live' ? 'selected' : ''}>Ao vivo</option><option value="finished" ${live.status === 'finished' ? 'selected' : ''}>Finalizada</option></select></label><label><span>Início</span><input name="startsAt" type="datetime-local" value="${new Date(live.starts_at).toISOString().slice(0,16)}"></label><label><span>Fim</span><input name="endsAt" type="datetime-local" value="${new Date(live.ends_at).toISOString().slice(0,16)}"></label><label><span>Mínimo (%)</span><input name="minimumPercent" type="number" value="${live.minimum_percent}"></label><label><span>Link da sala</span><input name="roomUrl" value="${escapeHtml(live.room_url)}"></label><label class="full"><span>Descrição</span><textarea name="description">${escapeHtml(live.description || '')}</textarea></label></form>`, `<button class="button ghost modal-cancel">Cancelar</button><button id="save-live" class="button primary">Salvar</button>`, true);
        $('.modal-cancel').onclick = close;
        $('#save-live').onclick = async () => {
          const payload = Object.fromEntries(new FormData($('#live-edit-form')));
          payload.startsAt = new Date(payload.startsAt).toISOString();
          payload.endsAt = new Date(payload.endsAt).toISOString();
          await api(`/api/teacher/live/${live.id}`, { method: 'PUT', body: payload });
          close(); toast('Aula atualizada.'); render();
        };
      }
    },

    async attendance() {
      setPage('Controle de presença e faltas', 'Administração');
      const data = await api('/api/teacher/attendance');
      view.innerHTML = `<div class="page-header"><div><h2>Presenças e faltas</h2><p>Uma falta online pelo conjunto semanal e uma falta por aula ao vivo.</p></div></div>
        <div class="section-title"><h2>Faltas registradas</h2></div><div class="table-wrap"><table><thead><tr><th>Aluno</th><th>Tipo</th><th>Semana</th><th>Motivo</th><th>Status</th><th>Ações</th></tr></thead><tbody>${data.absences.map(a => `<tr><td><strong>${escapeHtml(a.student_name)}</strong><br><small>${escapeHtml(a.email)}</small></td><td>${a.kind === 'online' ? 'Online semanal' : 'Aula ao vivo'}</td><td>${escapeHtml(a.week_key)}</td><td>${escapeHtml(a.reason || '')}</td><td><span class="badge ${Number(a.justified) ? '' : 'red'}">${Number(a.justified) ? 'Justificada' : 'Pendente'}</span></td><td><div class="actions"><button class="button secondary" data-justify="${a.id}" data-value="${Number(a.justified) ? 0 : 1}">${Number(a.justified) ? 'Retirar justificativa' : 'Justificar'}</button><button class="button danger" data-remove-absence="${a.id}">Remover</button></div></td></tr>`).join('') || '<tr><td colspan="6">Nenhuma falta registrada.</td></tr>'}</tbody></table></div>
        <div class="section-title"><h2>Tempo nas aulas ao vivo</h2></div><div class="table-wrap"><table><thead><tr><th>Aula</th><th>Aluno</th><th>Tempo registrado</th><th>Último sinal</th></tr></thead><tbody>${data.attendance.map(a => `<tr><td>${escapeHtml(a.live_title)}</td><td>${escapeHtml(a.student_name)}</td><td>${Math.floor(Number(a.seconds_present)/60)} min</td><td>${formatDate(a.last_seen_at)}</td></tr>`).join('') || '<tr><td colspan="4">Nenhuma participação registrada.</td></tr>'}</tbody></table></div>`;
      $$('[data-justify]').forEach(button => button.onclick = async () => {
        const reason = prompt('Motivo/observação da justificativa:', 'Justificada pelo professor.');
        if (reason === null) return;
        await api(`/api/teacher/absences/${button.dataset.justify}`, { method: 'PUT', body: { justified: button.dataset.value === '1', reason } });
        toast('Falta atualizada.'); navigate('attendance', {}, true);
      });
      $$('[data-remove-absence]').forEach(button => button.onclick = async () => {
        if (!confirm('Remover esta falta?')) return;
        await api(`/api/teacher/absences/${button.dataset.removeAbsence}`, { method: 'DELETE' });
        toast('Falta removida.'); navigate('attendance', {}, true);
      });
    },

    async reports() {
      setPage('Relatórios dos alunos', 'Acompanhamento individual');
      const data = await api('/api/teacher/reports');
      view.innerHTML = `<div class="page-header"><div><h2>Relatórios individuais</h2><p>Abra um aluno para ver entregas, notas, tentativas e faltas.</p></div></div><div class="table-wrap"><table><thead><tr><th>Aluno</th><th>Progresso</th><th>Média</th><th>Faltas</th><th>Ação</th></tr></thead><tbody>${data.students.map(s => `<tr><td><strong>${escapeHtml(s.name)}</strong><br><small>${escapeHtml(s.email)}</small></td><td>${s.progress}%</td><td>${s.grade}</td><td>${s.absences}</td><td><button class="button primary" data-report="${s.id}">Abrir relatório</button></td></tr>`).join('')}</tbody></table></div>`;
      $$('[data-report]').forEach(button => button.onclick = () => openReport(Number(button.dataset.report)));

      async function openReport(id) {
        loading('Gerando relatório...');
        const report = await api(`/api/teacher/reports/${id}`);
        setPage(`Relatório de ${report.student.name}`, 'Relatório individual');
        view.innerHTML = `<section class="card report-print"><div class="report-head"><div class="brand"><div><strong>Vanguard</strong><span>English School</span></div></div><div><h2 style="margin:0">Relatório individual</h2><p>${escapeHtml(report.student.name)} • ${escapeHtml(report.student.email)}</p></div></div><section class="grid three" style="margin-top:20px"><article class="card soft"><span class="stat-label">Progresso</span><b class="stat-value">${report.student.progress}%</b></article><article class="card soft"><span class="stat-label">Média</span><b class="stat-value">${report.student.grade}</b></article><article class="card soft"><span class="stat-label">Faltas</span><b class="stat-value">${report.student.absences}</b></article></section><div class="section-title"><h3>Entregas</h3></div><div class="table-wrap"><table><thead><tr><th>Atividade</th><th>Tipo</th><th>Nota</th><th>Tentativas</th><th>Áudio</th></tr></thead><tbody>${report.submissions.map(s => `<tr><td>${escapeHtml(s.activity_title)}<br><small>${escapeHtml(s.unit_title)}</small></td><td>${typeLabel(s.type)}</td><td>${Number(s.score).toFixed(1)}</td><td>${s.attempts}</td><td>${s.audio_path ? `<audio controls src="${escapeHtml(s.audio_path)}"></audio>` : '—'}</td></tr>`).join('') || '<tr><td colspan="5">Sem entregas.</td></tr>'}</tbody></table></div><div class="section-title"><h3>Faltas</h3></div><div class="list">${report.absences.map(a => `<div class="list-item"><div><strong>${a.kind === 'online' ? 'Online semanal' : 'Aula ao vivo'}</strong><p>${escapeHtml(a.reason || '')}</p></div><span class="badge ${Number(a.justified) ? '' : 'red'}">${Number(a.justified) ? 'Justificada' : 'Pendente'}</span></div>`).join('') || '<p>Nenhuma falta.</p>'}</div><div class="actions" style="margin-top:22px"><button id="back-reports" class="button ghost">← Voltar</button><button id="print-report" class="button primary">Imprimir / salvar PDF</button></div></section>`;
        $('#back-reports').onclick = () => navigate('reports');
        $('#print-report').onclick = () => window.print();
      }
    },

    async settings() {
      setPage('Configurações', 'Curso e comunicação');
      const students = await api('/api/teacher/students');
      view.innerHTML = `<div class="page-header"><div><h2>Configurações</h2><p>Defina regras do curso e envie avisos.</p></div></div><section class="grid two"><article class="card"><span class="eyebrow dark">Regras de presença</span><form id="settings-form" class="form-stack" style="margin-top:15px"><label><span>Atividades mínimas da semana (%)</span><input name="online_min_percent" type="number" min="0" max="100" value="${escapeHtml(state.settings.online_min_percent || '70')}"></label><label><span>Tempo mínimo da aula ao vivo (%)</span><input name="live_min_percent" type="number" min="0" max="100" value="${escapeHtml(state.settings.live_min_percent || '75')}"></label><label><span>Proteção de conteúdo</span><select name="content_protection"><option value="1" ${Number(state.settings.content_protection) ? 'selected' : ''}>Ativada</option><option value="0" ${!Number(state.settings.content_protection) ? 'selected' : ''}>Desativada</option></select></label><button class="button primary">Salvar configurações</button></form></article><article class="card"><span class="eyebrow dark">Enviar aviso</span><form id="notice-form" class="form-stack" style="margin-top:15px"><label><span>Destinatário</span><select name="targetStudentId"><option value="">Todos os alunos</option>${students.students.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}</select></label><label><span>Título</span><input name="title" required></label><label><span>Mensagem</span><textarea name="message" required></textarea></label><button class="button orange">Enviar aviso</button></form></article></section><section class="card soft" style="margin-top:20px"><h3>Proteção do conteúdo</h3><p>A plataforma bloqueia seleção, cópia, botão direito e atalhos básicos e mostra uma marca d’água com nome e e-mail do aluno. Nenhum site consegue impedir totalmente fotografias ou capturas de tela feitas pelo aparelho.</p></section>`;
      $('#settings-form').onsubmit = async event => {
        event.preventDefault();
        const result = await api('/api/teacher/settings', { method: 'PUT', body: Object.fromEntries(new FormData(event.target)) });
        state.settings = result.settings;
        toast('Configurações salvas.');
      };
      $('#notice-form').onsubmit = async event => {
        event.preventDefault();
        await api('/api/teacher/notices', { method: 'POST', body: Object.fromEntries(new FormData(event.target)) });
        event.target.reset();
        toast('Aviso enviado.');
      };
    }
  };

  $('#login-form').onsubmit = async event => {
    event.preventDefault();
    $('#login-message').textContent = '';
    try {
      await api('/api/login', {
        method: 'POST',
        body: { email: $('#login-email').value.trim(), password: $('#login-password').value, accessToken: state.token }
      });
      const result = await api('/api/me');
      state.user = result.user;
      state.settings = result.settings;
      showApp();
    } catch (error) {
      $('#login-message').textContent = error.message;
    }
  };

  $('#toggle-password').onclick = () => {
    const field = $('#login-password');
    field.type = field.type === 'password' ? 'text' : 'password';
    $('#toggle-password').textContent = field.type === 'password' ? 'Mostrar' : 'Ocultar';
  };

  $('#fill-demo').onclick = () => {
    const student = Boolean(state.token);
    $('#login-email').value = student ? 'ana@vanguard.demo' : 'professor@vanguard.demo';
    $('#login-password').value = student ? 'Aluno123' : 'Professor123';
  };

  $('#student-demo').onclick = () => {
    const url = new URL(location.href);
    url.searchParams.set('token', 'ana-vanguard-demo');
    url.hash = '';
    location.href = url.toString();
  };

  $('#teacher-login').onclick = () => {
    const url = new URL(location.href);
    url.searchParams.delete('token');
    url.hash = '';
    location.href = url.toString();
  };

  $('#logout-button').onclick = async () => {
    try { await api('/api/logout', { method: 'POST', body: {} }); } catch {}
    state.user = null;
    location.hash = '';
    showLogin(state.token);
  };

  $('#open-menu').onclick = () => {
    $('#sidebar').classList.add('open');
    $('#menu-backdrop').classList.add('active');
  };
  $('#close-menu').onclick = $('#menu-backdrop').onclick = () => {
    $('#sidebar').classList.remove('open');
    $('#menu-backdrop').classList.remove('active');
  };

  window.addEventListener('hashchange', () => {
    if (!state.user) return;
    const route = location.hash.replace('#', '') || (state.user.role === 'teacher' ? 'teacher-dashboard' : 'home');
    navigate(route, {}, true);
  });
  window.addEventListener('resize', () => { if (state.user?.role === 'student') createWatermark(); });

  async function bootstrap() {
    try {
      const result = await api('/api/me');
      state.user = result.user;
      state.settings = result.settings;
      showApp();
    } catch {
      showLogin(state.token);
    }
  }

  bootstrap();
})();
