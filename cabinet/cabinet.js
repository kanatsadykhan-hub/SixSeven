// Cabinet: optional email + password sign-in and the signed-in user's own leads.
// Leads are read straight from Supabase with the user's session; Row Level
// Security returns only rows whose user_id is this user. Lead text is rendered
// with textContent only.
import { getClient } from './auth.js';

const $ = (id) => document.getElementById(id);
const SECTIONS = ['cab-loading', 'cab-off', 'cab-signed-out', 'cab-check-email', 'cab-signed-in'];
const show = (id) => SECTIONS.forEach((s) => ($(s).hidden = s !== id));

// Generic messages: none of them tells whether an e-mail is registered.
const MESSAGES = {
  invalid_credentials: 'Неверный e-mail или пароль.',
  email_not_confirmed: 'Подтвердите e-mail по ссылке из письма, затем войдите.',
  weak_password: 'Пароль слишком простой: минимум 8 символов, лучше с цифрами и буквами.',
  over_request_rate_limit: 'Слишком много попыток. Попробуйте позже.',
  over_email_send_rate_limit: 'Не удалось отправить письмо. Попробуйте позже.',
  signup_disabled: 'Регистрация сейчас закрыта.',
};
const OFFLINE = 'Нет связи. Проверьте интернет и попробуйте ещё раз.';
const messageFor = (error) => {
  if (MESSAGES[error?.code]) return MESSAGES[error.code];
  if (error?.status === 429) return MESSAGES.over_request_rate_limit;
  // supabase-js reports a request that never got an answer as status 0.
  if (error?.name === 'AuthRetryableFetchError' || error?.status === 0) return OFFLINE;
  return 'Не получилось. Попробуйте ещё раз.';
};

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const client = await getClient();
if (!client) {
  show('cab-off');
} else {
  let mode = 'in';
  let shownUser = null;
  const form = $('auth-form');
  const status = $('auth-status');
  const submit = $('auth-submit');

  const setMode = (next) => {
    mode = next;
    const up = mode === 'up';
    $('tab-in').setAttribute('aria-selected', String(!up));
    $('tab-up').setAttribute('aria-selected', String(up));
    form.setAttribute('aria-labelledby', up ? 'tab-up' : 'tab-in');
    $('auth-consent-row').hidden = !up;
    $('auth-password-hint').hidden = !up;
    $('auth-password').autocomplete = up ? 'new-password' : 'current-password';
    submit.textContent = up ? 'Зарегистрироваться' : 'Войти';
    status.textContent = '';
    status.classList.remove('cab-error');
  };
  $('tab-in').addEventListener('click', () => setMode('in'));
  $('tab-up').addEventListener('click', () => setMode('up'));

  const fail = (text) => {
    status.textContent = text;
    status.classList.add('cab-error');
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    if (!$('auth-email').checkValidity()) return fail('Введите e-mail.');
    if (password.length < 8) return fail('Пароль: минимум 8 символов.');
    if (mode === 'up' && !$('auth-consent').checked) return fail('Отметьте согласие на обработку данных.');

    submit.disabled = true;
    status.classList.remove('cab-error');
    status.textContent = mode === 'up' ? 'Регистрируем…' : 'Входим…';
    try {
      if (mode === 'up') {
        // The confirmation link brings the user back to this page.
        const emailRedirectTo = location.href.split(/[?#]/)[0];
        const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo } });
        if (error) return fail(messageFor(error));
        // No session means e-mail confirmation is on (also for an address that
        // is already registered, so the answer is the same either way).
        if (!data.session) {
          $('check-email-address').textContent = email;
          show('cab-check-email');
        }
      } else {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) return fail(messageFor(error));
      }
      form.reset();
      status.textContent = '';
    } catch {
      fail(OFFLINE);
    } finally {
      submit.disabled = false;
    }
  });

  $('sign-out').addEventListener('click', async () => {
    $('sign-out').disabled = true;
    try {
      // Without a network signOut() keeps the session; then forget it on this device.
      const { error } = await client.auth.signOut();
      if (error) await client.auth.signOut({ scope: 'local' });
    } finally {
      $('sign-out').disabled = false;
    }
  });

  async function loadLeads() {
    const list = $('leads');
    const leadsStatus = $('leads-status');
    list.replaceChildren();
    $('leads-empty').hidden = true;
    leadsStatus.classList.remove('cab-error');
    leadsStatus.textContent = 'Загружаем заявки…';
    const { data, error } = await client
      .from('leads')
      .select('created_at, name, contact, message')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      leadsStatus.textContent = 'Не удалось загрузить заявки. Обновите страницу.';
      leadsStatus.classList.add('cab-error');
      return;
    }
    leadsStatus.textContent = '';
    $('leads-empty').hidden = data.length > 0;
    for (const lead of data) {
      const item = document.createElement('li');
      item.className = 'card cab-lead';
      const date = document.createElement('p');
      date.className = 'cab-date';
      date.textContent = lead.created_at ? dateFmt.format(new Date(lead.created_at)) : '';
      const who = document.createElement('p');
      who.className = 'cab-who';
      who.textContent = [lead.name, lead.contact].filter(Boolean).join(' · ');
      const message = document.createElement('p');
      message.className = 'cab-msg';
      message.textContent = lead.message || '—';
      item.append(date, who, message);
      list.append(item);
    }
  }

  const render = (session) => {
    const user = session?.user ?? null;
    if (!user) {
      shownUser = null;
      if (!$('cab-check-email').hidden) return;
      show('cab-signed-out');
      return;
    }
    show('cab-signed-in');
    $('me-email').textContent = user.email || '';
    // Token refreshes fire this too; reload the list only for a new user.
    if (shownUser !== user.id) {
      shownUser = user.id;
      loadLeads();
    }
  };

  setMode('in');
  // Fires INITIAL_SESSION first (including a session from a confirmation link),
  // then SIGNED_IN, SIGNED_OUT and TOKEN_REFRESHED.
  client.auth.onAuthStateChange((_event, session) => {
    // Supabase recommends not awaiting other Supabase calls inside this callback.
    setTimeout(() => render(session), 0);
  });
}
