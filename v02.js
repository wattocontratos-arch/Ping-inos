(() => {
  const baseRender = render;
  const by = (type) => records.filter(r => r.entity_type === type).map(r => ({ ...r.payload, __meta: r }));
  const sum = (items, pick) => items.reduce((s, x) => s + Number(pick(x) || 0), 0);
  const safe = (v) => esc(v ?? '—');
  const locked = (title, text) => `<div class="module-lock"><strong>${safe(title)}</strong><span>${safe(text)}</span></div>`;

  function renderExtras() {
    const ventas = by('venta');
    const clientes = by('cliente');
    const productos = by('producto');
    const envios = by('envio');
    const abonos = by('abono');
    const facturado = sum(ventas, v => v.precio || v.codigoPrecio || v.codigoP);
    const cobrado = sum(abonos, a => a.monto);
    const logistica = sum(envios, e => e.costoEnvio) + sum(envios, e => e.costoServientrega);
    const saldo = Math.max(0, facturado + logistica - cobrado);

    const live = document.getElementById('liveSummary');
    if (live) live.innerHTML = `<div class="metrics-grid compact"><article class="metric-card"><span>Productos</span><strong>${productos.length}</strong><small>catálogo Core</small></article><article class="metric-card"><span>Clientes</span><strong>${clientes.length}</strong><small>disponibles</small></article><article class="metric-card"><span>Ventas</span><strong>${ventas.length}</strong><small>${money(facturado)}</small></article><article class="metric-card"><span>Modo</span><strong>SAFE</strong><small>lectura web</small></article></div>${locked('Alta web protegida', 'La creación de ventas desde navegador se habilitará cuando el motor bidireccional ADMIN/OWNER esté validado. El iPhone sigue siendo la fuente operativa.')}`;

    const classification = document.getElementById('clasificacionSummary');
    if (classification) { const sinPaquete = ventas.filter(v => !v.envioId); classification.innerHTML = `<div class="metrics-grid compact"><article class="metric-card"><span>Sin paquete</span><strong>${sinPaquete.length}</strong><small>líneas visibles</small></article><article class="metric-card"><span>En paquete</span><strong>${ventas.length - sinPaquete.length}</strong><small>líneas</small></article></div>${locked('Clasificación operativa', 'Las marcas físicas de clasificación viven en la capa operacional móvil y todavía no se escriben desde la web.')}`; }

    const liquid = document.getElementById('liquidacionSummary');
    if (liquid) liquid.innerHTML = `<div class="metrics-grid compact"><article class="metric-card"><span>Compras</span><strong>${money(facturado)}</strong><small>${ventas.length} ventas</small></article><article class="metric-card"><span>Abonos</span><strong>${money(cobrado)}</strong><small>${abonos.length} pagos</small></article><article class="metric-card"><span>Logística</span><strong>${money(logistica)}</strong><small>${envios.length} paquetes</small></article><article class="metric-card"><span>Saldo estimado</span><strong>${money(saldo)}</strong><small>Core actual</small></article></div>${locked('Liquidación avanzada', 'PDF, ciclos pagados y cierre de cartera permanecerán en la app hasta validar escritura bidireccional y auditoría.')}`;

    const reports = document.getElementById('reportesSummary');
    if (reports) reports.innerHTML = `<div class="metrics-grid compact"><article class="metric-card"><span>Facturado</span><strong>${money(facturado)}</strong><small>sin filtro</small></article><article class="metric-card"><span>Cobrado</span><strong>${money(cobrado)}</strong><small>sin filtro</small></article><article class="metric-card"><span>Clientes</span><strong>${clientes.length}</strong><small>Core</small></article><article class="metric-card"><span>Paquetes activos</span><strong>${envios.filter(e => e.estado !== 'entregado').length}</strong><small>operación</small></article></div>`;

    const direcciones = document.getElementById('direccionesSummary');
    if (direcciones) direcciones.innerHTML = locked('Direcciones', 'Provincia, ciudad, dirección exacta, referencia y teléfono todavía permanecen en la capa operacional móvil hasta que se incorporen como entidad Core versionada.');
    const config = document.getElementById('configSummary');
    if (config) config.innerHTML = locked('Configuración protegida', 'Empresa, tarifas por libra y Servientrega siguen siendo configuración local-first. La web no cambia esos valores todavía.');
    const security = document.getElementById('securitySummary');
    if (security) security.innerHTML = `<div class="status-list"><div class="status-row"><span>Auth</span><strong>ACTIVO</strong></div><div class="status-row"><span>Rol</span><strong>${safe(roleLabel(membership?.role))}</strong></div><div class="status-row"><span>RLS</span><strong>CORE</strong></div><div class="status-row"><span>Bootstrap</span><strong>${bootstrapRuns?.[0]?.status || 'PENDIENTE'}</strong></div></div>${locked('Backup / Restore', 'Los respaldos verificados y Restore Lab siguen ejecutándose desde el dispositivo para no arriesgar los datos reales.')}`;

    const teamTools = document.getElementById('teamTools');
    if (teamTools) {
      const role = String(membership?.role || '').toUpperCase();
      if (role === 'OWNER' || role === 'ADMIN') {
        const options = role === 'OWNER' ? '<option value="ADMIN">ADMINISTRADOR</option><option value="STAFF">EMPLEADO</option>' : '<option value="STAFF">EMPLEADO</option>';
        teamTools.innerHTML = `<div class="invite-box"><div><p class="eyebrow">Invitaciones</p><h3>Crear acceso</h3><p class="muted">Código de un solo uso. ${role === 'ADMIN' ? 'Como ADMIN solo puedes crear EMPLEADOS.' : 'Como DUEÑA puedes crear ADMINISTRADORES o EMPLEADOS.'}</p></div><div class="invite-controls"><select id="inviteRole">${options}</select><button id="createInvite" class="primary small-primary">Generar código</button></div><div id="inviteResult"></div></div>`;
        document.getElementById('createInvite').onclick = async () => {
          const btn = document.getElementById('createInvite'); const out = document.getElementById('inviteResult'); btn.disabled = true; out.textContent = 'Generando…';
          try { const roleWanted = document.getElementById('inviteRole').value; const data = await api('/rest/v1/rpc/create_organization_invite', { method:'POST', body: JSON.stringify({ p_organization_id: membership.organization_id, p_role: roleWanted, p_expires_hours: 168 }) }); const row = Array.isArray(data) ? data[0] : data; const token = row?.token || row?.invite_code || row?.code || (typeof data === 'string' ? data : null); out.innerHTML = token ? `<div class="invite-code">${safe(token)}</div><p class="muted">Válido 7 días · un solo uso</p>` : `<pre>${safe(JSON.stringify(data))}</pre>`; }
          catch (e) { out.innerHTML = `<p class="error">${safe(e.message || e)}</p>`; } finally { btn.disabled = false; }
        };
      } else teamTools.innerHTML = locked('Acceso restringido', 'Solo DUEÑA y ADMINISTRADOR pueden crear invitaciones.');
    }
  }

  render = function() { baseRender(); renderExtras(); };
})();