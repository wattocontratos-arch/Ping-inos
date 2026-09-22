const CORE_URL = 'https://ssijotinkndqqinxgbdf.supabase.co';
const CORE_KEY = 'sb_publishable_oFt-N9ay00CI9Pdz39pkUw_dVoTkQNK';
const STORAGE_KEY = 'elystore_web_session_v1';
const PENDING_INVITE_KEY = 'elystore_web_pending_invite_v1';

let session = null;
let membership = null;
let records = [];
let bootstrapRuns = [];
let syncRuns = [];
let devices = [];
let team = [];

const $ = (id) => document.getElementById(id);
const money = (v) => `$${Number(v || 0).toFixed(2)}`;
const fmt = (v) => v ? new Date(v).toLocaleString('es-EC') : '—';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function parseResponse(res) {
  const text = await res.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!res.ok) {
    const message = typeof payload === 'string'
      ? payload
      : payload?.message || payload?.error_description || payload?.error || `HTTP ${res.status}`;
    throw new Error(String(message));
  }
  return payload;
}

async function authApi(path, options = {}) {
  const res = await fetch(`${CORE_URL}${path}`, {
    ...options,
    headers: {
      apikey: CORE_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  return parseResponse(res);
}

async function api(path, options = {}) {
  const headers = {
    apikey: CORE_KEY,
    'Content-Type': 'application/json',
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(`${CORE_URL}${path}`, { ...options, headers });
  return parseResponse(res);
}

function normalizeInvite(value) {
  return String(value || '').trim().toUpperCase();
}

async function claimInvite(code) {
  if (!session?.access_token) throw new Error('Primero inicia sesión.');
  const normalized = normalizeInvite(code);
  if (normalized.length < 8) throw new Error('El código de activación no es válido.');
  await api('/rest/v1/rpc/claim_organization_invite', {
    method: 'POST',
    body: JSON.stringify({ p_token: normalized }),
  });
  localStorage.removeItem(PENDING_INVITE_KEY);
}

async function claimPendingInvite() {
  const pending = localStorage.getItem(PENDING_INVITE_KEY);
  if (!pending) return false;
  await claimInvite(pending);
  return true;
}

async function login(email, password) {
  const data = await authApi('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  session = data;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

  let claimError = null;
  try {
    await claimPendingInvite();
  } catch (error) {
    claimError = error;
  }

  try {
    await loadCore();
  } catch (loadError) {
    if (claimError) throw claimError;
    throw loadError;
  }
}

async function signup(email, password, confirmation, inviteCode) {
  const normalizedEmail = email.trim().toLowerCase();
  const code = normalizeInvite(inviteCode);
  if (!normalizedEmail || !normalizedEmail.includes('@')) throw new Error('Ingresa un correo válido.');
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');
  if (code.length < 8) throw new Error('Ingresa un código de activación válido.');

  localStorage.setItem(PENDING_INVITE_KEY, code);
  const data = await authApi('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email: normalizedEmail, password }),
  });

  if (data?.access_token && data?.user) {
    session = data;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    await claimPendingInvite();
    await loadCore();
    return { confirmed: true };
  }

  return { confirmed: false };
}

async function loadCore() {
  if (!session?.user?.id) throw new Error('Sesión inválida.');
  const memberships = await api(`/rest/v1/organization_members?select=organization_id,role&user_id=eq.${encodeURIComponent(session.user.id)}`);
  membership = memberships?.[0];
  if (!membership) throw new Error('Tu cuenta todavía no está vinculada a ElyStore. Si acabas de confirmar el correo, vuelve a iniciar sesión para aplicar el código de activación.');

  const org = encodeURIComponent(membership.organization_id);
  [records, bootstrapRuns, syncRuns, devices, team] = await Promise.all([
    api(`/rest/v1/sync_records?select=entity_type,local_id,payload,revision,updated_at,deleted_at&organization_id=eq.${org}&deleted_at=is.null&order=updated_at.desc`),
    api(`/rest/v1/sync_bootstrap_runs?select=*&organization_id=eq.${org}&order=started_at.desc&limit=10`),
    api(`/rest/v1/sync_runs?select=*&organization_id=eq.${org}&order=started_at.desc&limit=20`),
    api(`/rest/v1/sync_devices?select=*&organization_id=eq.${org}&order=last_seen_at.desc`),
    api(`/rest/v1/organization_members?select=user_id,role,created_at&organization_id=eq.${org}&order=created_at.asc`),
  ]);
  render();
}

function byType(type) {
  return records.filter(r => r.entity_type === type).map(r => ({ ...r.payload, __meta: r }));
}

function table(headers, rows) {
  if (!rows.length) return '<div class="empty">Aún no hay información sincronizada.</div>';
  return `<table class="data-table"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function packageNumber(envio, index, all) {
  const stored = Number(envio.numeroPaquete);
  if (Number.isFinite(stored) && stored > 0) return stored;
  return Math.max(1, all.length - index);
}

function roleLabel(role) {
  const normalized = String(role || '').toUpperCase();
  if (normalized === 'OWNER') return 'DUEÑA';
  if (normalized === 'ADMIN') return 'ADMINISTRADOR';
  if (normalized === 'STAFF') return 'EMPLEADO';
  return normalized || '—';
}

function render() {
  $('loginView').hidden = true;
  $('dashboardView').hidden = false;
  $('userEmail').textContent = session.user.email || 'Usuario';
  $('userRole').textContent = roleLabel(membership.role);

  const ventas = byType('venta');
  const clientes = byType('cliente');
  const productos = byType('producto');
  const envios = byType('envio').sort((a,b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  const abonos = byType('abono');
  const ventaTotal = ventas.reduce((s,v) => s + Number(v.precio || v.codigoPrecio || v.codigoP || 0), 0);
  const abonoTotal = abonos.reduce((s,a) => s + Number(a.monto || 0), 0);

  $('metricVentas').textContent = ventas.length;
  $('metricVentasTotal').textContent = money(ventaTotal);
  $('metricClientes').textContent = clientes.length;
  $('metricEnvios').textContent = envios.length;
  $('metricEnviosActivos').textContent = `${envios.filter(e => !['entregado'].includes(e.estado)).length} activos`;
  $('metricAbonos').textContent = abonos.length;
  $('metricAbonosTotal').textContent = money(abonoTotal);

  const latestBootstrap = bootstrapRuns?.[0];
  const verified = latestBootstrap?.status === 'VERIFIED' || latestBootstrap?.status === 'verified';
  $('syncBanner').className = `banner ${verified ? 'ok' : 'warning'}`;
  $('syncBanner').textContent = verified
    ? `Core verificado · última copia ${fmt(latestBootstrap.finished_at || latestBootstrap.started_at)}`
    : 'Aún no hay una copia inicial verificada de ElyStore Core. No se muestran datos del iPhone hasta que Ely complete el bootstrap.';

  $('recentSales').innerHTML = table(['Producto','Cliente','Precio','Actualizado'], ventas.slice(0,8).map(v => `<tr><td>${esc(v.producto || 'Sin nombre')}</td><td>${esc(v.cliente || v.codigoCliente || '—')}</td><td>${money(v.precio || v.codigoPrecio || v.codigoP)}</td><td>${esc(fmt(v.__meta.updated_at))}</td></tr>`));
  $('cloudSummary').innerHTML = [
    ['Bootstrap', verified ? 'VERIFICADO' : 'Pendiente'],
    ['Registros Core', records.length],
    ['Dispositivos', devices.length],
    ['Última sync', fmt(syncRuns?.[0]?.finished_at || syncRuns?.[0]?.started_at)],
  ].map(([a,b]) => `<div class="status-row"><span>${esc(a)}</span><strong>${esc(b)}</strong></div>`).join('');

  $('ventasTable').innerHTML = table(['Producto','Cliente','Código','Precio','Fecha'], ventas.map(v => `<tr><td>${esc(v.producto || 'Sin nombre')}</td><td>${esc(v.cliente || '—')}</td><td>${esc(v.codigoCliente || '—')}</td><td>${money(v.precio || v.codigoPrecio || v.codigoP)}</td><td>${esc(fmt(v.fecha))}</td></tr>`));
  $('clientesTable').innerHTML = table(['Nombre','Código','ID'], clientes.map(c => `<tr><td>${esc(c.nombre)}</td><td>${esc(c.codigo)}</td><td>${esc(c.id)}</td></tr>`));
  $('productosTable').innerHTML = table(['Producto','Código','Precio','Peso'], productos.map(p => `<tr><td>${esc(p.nombre)}</td><td>${esc(p.codigo)}</td><td>${money(p.precio)}</td><td>${p.peso == null ? '—' : `${Number(p.peso).toFixed(2)} lb`}</td></tr>`));
  $('enviosTable').innerHTML = table(['N.º','Código paquete','Ciudad','Peso','Estado','Guía'], envios.map((e,i) => `<tr><td><span class="package-number">#${packageNumber(e,i,envios)}</span></td><td>${esc(e.id)}</td><td>${esc(e.ciudadDestino || '—')}</td><td>${Number(e.pesoTotal || 0).toFixed(2)} lb</td><td><span class="pill pink">${esc(e.estado || '—')}</span></td><td>${esc(e.numeroGuia || '—')}</td></tr>`));
  $('abonosTable').innerHTML = table(['Cliente ID','Monto','Método','Fecha'], abonos.map(a => `<tr><td>${esc(a.clienteId || '—')}</td><td>${money(a.monto)}</td><td>${esc(a.metodoPago || '—')}</td><td>${esc(fmt(a.fecha))}</td></tr>`));

  $('bootstrapDetail').innerHTML = latestBootstrap ? Object.entries({Estado:latestBootstrap.status,Inicio:fmt(latestBootstrap.started_at),Fin:fmt(latestBootstrap.finished_at),Esperado:JSON.stringify(latestBootstrap.expected_counts || {}),Verificado:JSON.stringify(latestBootstrap.verified_counts || {})}).map(([a,b]) => `<div class="status-row"><span>${esc(a)}</span><strong>${esc(b)}</strong></div>`).join('') : '<div class="empty">Sin bootstrap registrado.</div>';
  $('devicesDetail').innerHTML = devices.length ? devices.map(d => `<div class="status-row"><span>${esc(d.label || d.platform || 'Dispositivo')}</span><strong>${esc(`${d.app_version || '—'} (${d.build_number || '—'})`)}</strong></div>`).join('') : '<div class="empty">Sin dispositivos sincronizados.</div>';
  $('runsTable').innerHTML = table(['Dirección','Estado','Inicio','Fin'], syncRuns.map(r => `<tr><td>${esc(r.direction)}</td><td>${esc(r.status)}</td><td>${esc(fmt(r.started_at))}</td><td>${esc(fmt(r.finished_at))}</td></tr>`));
  $('teamDetail').innerHTML = team.length ? team.map(m => `<div class="status-row"><span>${esc(m.user_id.slice(0,8))}…</span><strong>${esc(roleLabel(m.role))}</strong></div>`).join('') : '<div class="empty">Sin miembros.</div>';

  applyFilters();
}

function applyFilters() {
  document.querySelectorAll('[data-search]').forEach(input => {
    input.oninput = () => {
      const q = input.value.toLowerCase();
      const target = `${input.dataset.search}sTable`;
      const box = document.getElementById(target);
      if (!box) return;
      box.querySelectorAll('tbody tr').forEach(tr => tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none');
    };
  });
}

function setAuthMode(mode) {
  const signup = mode === 'signup';
  $('signupForm').hidden = !signup;
  $('loginForm').hidden = signup;
  $('signupTab').classList.toggle('active', signup);
  $('loginTab').classList.toggle('active', !signup);
}

$('signupTab').addEventListener('click', () => setAuthMode('signup'));
$('loginTab').addEventListener('click', () => setAuthMode('login'));

document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active-section'));
  document.getElementById(`section-${btn.dataset.section}`).classList.add('active-section');
  $('sectionTitle').textContent = btn.textContent;
}));

$('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('signupButton');
  $('signupError').hidden = true;
  $('signupSuccess').hidden = true;
  button.disabled = true;
  button.textContent = 'Creando cuenta…';
  try {
    const email = $('signupEmail').value.trim();
    const result = await signup(
      email,
      $('signupPassword').value,
      $('signupPasswordConfirm').value,
      $('activationCode').value
    );
    if (!result.confirmed) {
      $('signupSuccess').textContent = 'Cuenta creada. Revisa tu correo y confirma la dirección. Si la página final de confirmación no carga, la confirmación igualmente puede haberse completado: vuelve a ElyStore Web, abre “Ya tengo cuenta” e inicia sesión con el mismo correo y contraseña. El código quedó guardado localmente para vincularse al entrar.';
      $('signupSuccess').hidden = false;
      $('email').value = email;
    }
  } catch (err) {
    $('signupError').textContent = err.message || 'No se pudo crear la cuenta.';
    $('signupError').hidden = false;
    if (/already|registered|exists|already been registered/i.test(String(err.message || ''))) {
      $('signupError').textContent = 'Ese correo ya tiene cuenta. Usa “Ya tengo cuenta” para iniciar sesión.';
    }
  } finally {
    button.disabled = false;
    button.textContent = 'Crear cuenta y vincular';
  }
});

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('loginButton');
  $('loginError').hidden = true;
  button.disabled = true;
  button.textContent = 'Conectando…';
  try {
    await login($('email').value.trim(), $('password').value);
  } catch (err) {
    $('loginError').textContent = err.message || 'No se pudo iniciar sesión.';
    $('loginError').hidden = false;
    localStorage.removeItem(STORAGE_KEY);
    session = null;
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar a ElyStore Web';
  }
});

$('logoutButton').addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

(async function boot() {
  setAuthMode('signup');
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    session = JSON.parse(raw);
    await loadCore();
  } catch (_) {
    localStorage.removeItem(STORAGE_KEY);
    session = null;
  }
})();