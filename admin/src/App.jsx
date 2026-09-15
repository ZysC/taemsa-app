import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  collection, onSnapshot, orderBy,
  query, deleteDoc, doc, getDoc,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import {
  createNotificationWithReceipts,
  createFarmaticUpdate,
  createInfoArticle,
  deleteFarmaticUpdate,
  deleteInfoArticle,
  deleteNotificationWithReceipts,
  loadNotificationReceipts,
  sendExpoPushes,
} from './sendPush';
import {
  clientDeviceStats,
  createClient,
  deleteClientAndDevices,
  setClientActive,
} from './clientsApi';
import Login from './Login';
import './App.css';

const TYPES = [
  { value: 'info',     label: 'ℹ️  Información',   color: '#6B7280' },
  { value: 'novedad',  label: '🟢 Novedad',         color: '#10B981' },
  { value: 'problema', label: '⚠️  Problema',        color: '#F59E0B' },
  { value: 'error',    label: '🔴 Error / Urgente', color: '#EF4444' },
];

const TYPE_STYLES = {
  error:    { bg: '#FEE2E2', border: '#EF4444', badge: '#EF4444' },
  problema: { bg: '#FEF3C7', border: '#F59E0B', badge: '#F59E0B' },
  novedad:  { bg: '#D1FAE5', border: '#10B981', badge: '#10B981' },
  info:     { bg: '#F3F4F6', border: '#6B7280', badge: '#6B7280' },
};

const TYPE_ICONS = {
  error: '🔴', problema: '⚠️', novedad: '🟢', info: 'ℹ️',
};

function receiptList(receipts) {
  if (Array.isArray(receipts)) {
    return receipts.map((r) => ({
      id: r.id,
      clientName: r.clientName || r.id,
      deviceName: r.deviceName || '',
      delivered: !!(r.deliveredAt),
      read: !!(r.readAt),
    }));
  }
  return Object.entries(receipts || {}).map(([id, r]) => ({
    id,
    clientName: r.clientName || id,
    deviceName: r.deviceName || '',
    delivered: !!(r.deliveredAt),
    read: !!(r.readAt),
  }));
}

function deviceLabel(d) {
  if (d.deviceName) return d.deviceName;
  return d.platform || 'Dispositivo';
}

function formatLastSeen(ms) {
  if (!ms) return 'Sin actividad';
  return new Date(ms).toLocaleString('es-ES');
}

function AdminPanel({ user }) {
  const [section, setSection] = useState('avisos');
  const [form, setForm] = useState({ title: '', body: '', type: 'info' });
  const [farmaticForm, setFarmaticForm] = useState({
    version: '', title: '', body: '', notifyPush: true,
  });
  const [infoForm, setInfoForm] = useState({
    title: '', body: '', notifyPush: true, pdfFiles: [],
  });
  const [notifications, setNotifications] = useState([]);
  const [farmaticUpdates, setFarmaticUpdates] = useState([]);
  const [infoArticles, setInfoArticles] = useState([]);
  const [sending, setSending] = useState(false);
  const [farmaticSending, setFarmaticSending] = useState(false);
  const [infoSending, setInfoSending] = useState(false);
  const [deviceList, setDeviceList] = useState([]);
  const [clients, setClients] = useState([]);
  const [pushDevices, setPushDevices] = useState(0);
  const [success, setSuccess] = useState('');
  const [farmaticSuccess, setFarmaticSuccess] = useState('');
  const [infoSuccess, setInfoSuccess] = useState('');
  const [openReceipts, setOpenReceipts] = useState(null);
  const [receiptsByNotif, setReceiptsByNotif] = useState({});
  const [loadingReceipts, setLoadingReceipts] = useState(null);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [clientNameInput, setClientNameInput] = useState('');
  const [creatingClient, setCreatingClient] = useState(false);
  const [createdCode, setCreatedCode] = useState('');
  const [clientSuccess, setClientSuccess] = useState('');
  const [expandedClient, setExpandedClient] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'notifications'), orderBy('createdAt', 'desc')),
      (snap) => setNotifications(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    );

    const unsubFarmatic = onSnapshot(
      query(collection(db, 'farmaticUpdates'), orderBy('createdAt', 'desc')),
      (snap) => setFarmaticUpdates(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    );

    const unsubInfo = onSnapshot(
      query(collection(db, 'infoArticles'), orderBy('createdAt', 'desc')),
      (snap) => setInfoArticles(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    );

    const unsub2 = onSnapshot(
      collection(db, 'devices'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setDeviceList(list);
        setPushDevices(list.filter((d) => typeof d.token === 'string' && d.token.length > 10).length);
      },
      (err) => console.error('Error leyendo devices:', err),
    );

    const unsubClients = onSnapshot(
      collection(db, 'clients'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
        setClients(list);
      },
      (err) => console.error('Error leyendo clients:', err),
    );

    return () => { unsub(); unsubFarmatic(); unsubInfo(); unsub2(); unsubClients(); };
  }, []);

  const devicesByClient = useMemo(() => {
    const map = {};
    deviceList.forEach((d) => {
      const key = d.clientId || '_sin_cliente';
      if (!map[key]) map[key] = [];
      map[key].push(d);
    });
    return map;
  }, [deviceList]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) return;
    setSending(true);
    try {
      const created = await createNotificationWithReceipts(form);
      let pushResult = { sent: 0 };
      try {
        pushResult = await sendExpoPushes({
          ...form,
          notificationId: created.id,
          devices: created.devices,
          channel: 'alerts',
        });
      } catch (pushErr) {
        console.error(pushErr);
      }
      setForm({ title: '', body: '', type: 'info' });
      setSuccess(
        pushResult.sent > 0
          ? `Enviado a ${pushResult.sent} dispositivo(s) con avisos activados.`
          : 'Publicado en el listado. Ningún dispositivo con avisos + token push.',
      );
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      alert('Error al enviar: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  const handleFarmaticSend = async (e) => {
    e.preventDefault();
    if (!farmaticForm.title.trim() || !farmaticForm.body.trim()) return;
    setFarmaticSending(true);
    try {
      const created = await createFarmaticUpdate(farmaticForm);
      let pushResult = { sent: 0 };
      if (farmaticForm.notifyPush) {
        try {
          pushResult = await sendExpoPushes({
            title: farmaticForm.title,
            body: farmaticForm.body,
            type: 'farmatic',
            notificationId: created.id,
            channel: 'farmatic',
          });
        } catch (pushErr) {
          console.error(pushErr);
        }
      }
      setFarmaticForm({ version: '', title: '', body: '', notifyPush: true });
      setFarmaticSuccess(
        farmaticForm.notifyPush
          ? (pushResult.sent > 0
            ? `Publicada y avisados ${pushResult.sent} dispositivo(s).`
            : 'Publicada en el historial. Ningún dispositivo con Farmatic + token push.')
          : 'Publicada en el historial (sin push).',
      );
      setTimeout(() => setFarmaticSuccess(''), 4000);
    } catch (err) {
      alert('Error al publicar: ' + err.message);
    } finally {
      setFarmaticSending(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar esta notificación?')) return;
    await deleteNotificationWithReceipts(id);
    setReceiptsByNotif((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const toggleReceipts = async (notificationId) => {
    if (openReceipts === notificationId) {
      setOpenReceipts(null);
      return;
    }
    setOpenReceipts(notificationId);
    if (receiptsByNotif[notificationId]) return;
    setLoadingReceipts(notificationId);
    try {
      const rows = await loadNotificationReceipts(notificationId);
      setReceiptsByNotif((prev) => ({ ...prev, [notificationId]: rows }));
    } catch (err) {
      console.error(err);
      setReceiptsByNotif((prev) => ({ ...prev, [notificationId]: [] }));
    } finally {
      setLoadingReceipts(null);
    }
  };

  const handleDeleteFarmatic = async (id) => {
    if (!confirm('¿Eliminar esta actualización Farmatic?')) return;
    await deleteFarmaticUpdate(id);
  };

  const handleInfoSend = async (e) => {
    e.preventDefault();
    if (!infoForm.title.trim() || !infoForm.body.trim()) return;
    setInfoSending(true);
    try {
      const created = await createInfoArticle(infoForm, infoForm.pdfFiles);
      let pushResult = { sent: 0 };
      if (infoForm.notifyPush) {
        try {
          pushResult = await sendExpoPushes({
            title: infoForm.title,
            body: infoForm.body,
            type: 'info',
            notificationId: created.id,
            channel: 'info',
          });
        } catch (pushErr) {
          console.error(pushErr);
        }
      }
      setInfoForm({ title: '', body: '', notifyPush: true, pdfFiles: [] });
      setInfoSuccess(
        infoForm.notifyPush
          ? (pushResult.sent > 0
            ? `Publicada y avisados ${pushResult.sent} dispositivo(s).`
            : 'Publicada. Ningún dispositivo con Información + token push.')
          : 'Publicada (sin push).',
      );
      setTimeout(() => setInfoSuccess(''), 4000);
    } catch (err) {
      alert('Error al publicar: ' + err.message);
    } finally {
      setInfoSending(false);
    }
  };

  const handleDeleteInfo = async (article) => {
    if (!confirm('¿Eliminar esta información?')) return;
    await deleteInfoArticle(article);
  };

  const handleDeleteDevice = async (id) => {
    if (!confirm('¿Eliminar este dispositivo?')) return;
    await deleteDoc(doc(db, 'devices', id));
  };

  const handleCreateClient = async (e) => {
    e.preventDefault();
    if (!clientNameInput.trim() || creatingClient) return;
    setCreatingClient(true);
    setCreatedCode('');
    try {
      const created = await createClient(clientNameInput);
      setClientNameInput('');
      setCreatedCode(created.id);
      setClientSuccess(`Cliente creado: ${created.name}`);
      setTimeout(() => setClientSuccess(''), 4000);
    } catch (err) {
      alert('Error al crear cliente: ' + err.message);
    } finally {
      setCreatingClient(false);
    }
  };

  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setClientSuccess(`Código ${code} copiado`);
      setTimeout(() => setClientSuccess(''), 2500);
    } catch {
      alert('Copia manualmente: ' + code);
    }
  };

  const handleToggleClient = async (client) => {
    const next = !client.active;
    const label = next ? 'activar' : 'desactivar';
    if (!confirm(`¿${label.charAt(0).toUpperCase() + label.slice(1)} a ${client.name}?`)) return;
    try {
      await setClientActive(client.id, next);
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleDeleteClient = async (client) => {
    const stats = clientDeviceStats(client.id, deviceList);
    const msg = stats.count > 0
      ? `¿Borrar ${client.name} y sus ${stats.count} dispositivo(s)?`
      : `¿Borrar cliente ${client.name}?`;
    if (!confirm(msg)) return;
    try {
      await deleteClientAndDevices(client.id, deviceList);
      if (expandedClient === client.id) setExpandedClient(null);
    } catch (err) {
      alert('Error al borrar: ' + err.message);
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-text">TAEMSA</span>
          <span className="logo-sub">Panel de soporte</span>
        </div>

        <nav className="side-nav">
          <button
            type="button"
            className={`side-nav-btn ${section === 'avisos' ? 'active' : ''}`}
            onClick={() => setSection('avisos')}
          >
            Avisos
          </button>
          <button
            type="button"
            className={`side-nav-btn ${section === 'farmatic' ? 'active' : ''}`}
            onClick={() => setSection('farmatic')}
          >
            Farmatic
          </button>
          <button
            type="button"
            className={`side-nav-btn ${section === 'info' ? 'active' : ''}`}
            onClick={() => setSection('info')}
          >
            Información
          </button>
          <button
            type="button"
            className={`side-nav-btn ${section === 'clientes' ? 'active' : ''}`}
            onClick={() => setSection('clientes')}
          >
            Clientes
          </button>
        </nav>

        <div className="stat-box devices-stat">
          <button
            type="button"
            className="devices-toggle"
            onClick={() => setDevicesOpen((open) => !open)}
            aria-expanded={devicesOpen}
          >
            <span className="stat-number">{deviceList.length}</span>
            <span className="stat-label">
              Dispositivos registrados
              <span className="devices-caret">{devicesOpen ? '▴' : '▾'}</span>
            </span>
          </button>

          {devicesOpen && (
            <div className="device-list">
              {deviceList.length === 0 ? (
                <div className="device-empty">Ningún dispositivo</div>
              ) : (
                Object.entries(devicesByClient).map(([clientKey, devices]) => {
                  const client = clients.find((c) => c.id === clientKey);
                  const label = client?.name || devices[0]?.clientName || clientKey;
                  return (
                    <div key={clientKey} className="device-group">
                      <div className="device-group-title">
                        {label}
                        {clientKey !== '_sin_cliente' && (
                          <span className="device-group-code">{clientKey}</span>
                        )}
                      </div>
                      {devices.map((d) => (
                        <div key={d.id} className="device-row">
                          <div className="device-info">
                            <span className="device-name">{deviceLabel(d)}</span>
                            <span className="device-prefs">
                              {d.platform || '—'} · {formatLastSeen(
                                d.lastSeenAt?.toMillis?.() || d.updatedAt?.toMillis?.() || 0,
                              )}
                            </span>
                          </div>
                          <button
                            className="delete-btn"
                            onClick={() => handleDeleteDevice(d.id)}
                            title="Eliminar dispositivo"
                          >
                            🗑️
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="stat-box">
          <span className="stat-number">{clients.filter((c) => c.active).length}</span>
          <span className="stat-label">Clientes activos</span>
        </div>

        <div className="stat-box">
          <span className="stat-number">{pushDevices}</span>
          <span className="stat-label">Con token push</span>
        </div>

        <div className="stat-box">
          <span className="stat-number">{notifications.length}</span>
          <span className="stat-label">Avisos enviados</span>
        </div>

        <div className="stat-box">
          <span className="stat-number">{farmaticUpdates.length}</span>
          <span className="stat-label">Actualizaciones Farmatic</span>
        </div>

        <div className="stat-box">
          <span className="stat-number">{infoArticles.length}</span>
          <span className="stat-label">Artículos de información</span>
        </div>

        <div className="sidebar-footer">
          <div className="admin-email" title={user.email}>{user.email}</div>
          <button type="button" className="logout-btn" onClick={() => signOut(auth)}>
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="main">
        {section === 'avisos' && (
          <>
            <h1 className="page-title">Enviar aviso</h1>

            <form onSubmit={handleSend} className="form-card">
              <div className="form-group">
                <label>Tipo</label>
                <div className="type-buttons">
                  {TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      className={`type-btn ${form.type === t.value ? 'active' : ''}`}
                      style={form.type === t.value ? { borderColor: t.color, color: t.color } : {}}
                      onClick={() => setForm({ ...form, type: t.value })}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="title">Título</label>
                <input
                  id="title"
                  type="text"
                  placeholder="Ej: Mantenimiento programado"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="body">Mensaje</label>
                <textarea
                  id="body"
                  placeholder="Describe el problema o la novedad..."
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  rows={4}
                  required
                />
              </div>

              <button type="submit" className="send-btn" disabled={sending}>
                {sending ? 'Enviando...' : 'Enviar aviso'}
              </button>

              {success && <div className="success-msg">{success}</div>}
            </form>

            <h2 className="section-title">Historial de avisos</h2>

            {notifications.length === 0 ? (
              <div className="empty">Aún no hay avisos enviados</div>
            ) : (
              <div className="notif-list">
                {notifications.map((n) => {
                  const s = TYPE_STYLES[n.type] || TYPE_STYLES.info;
                  const icon = TYPE_ICONS[n.type] || 'ℹ️';
                  const date = n.createdAt?.toDate?.()?.toLocaleString('es-ES') || '';
                  const rows = receiptList(receiptsByNotif[n.id] || n.receipts);
                  const delivered = rows.filter((r) => r.delivered).length;
                  const read = rows.filter((r) => r.read).length;
                  const open = openReceipts === n.id;
                  const loaded = !!receiptsByNotif[n.id];
                  return (
                    <div
                      key={n.id}
                      className="notif-card"
                      style={{ backgroundColor: s.bg, borderLeftColor: s.border }}
                    >
                      <div className="notif-header">
                        <span>{icon}</span>
                        <strong>{n.title}</strong>
                        <span className="notif-badge" style={{ backgroundColor: s.badge }}>
                          {n.type}
                        </span>
                        <button className="delete-btn" onClick={() => handleDelete(n.id)} title="Eliminar">
                          🗑️
                        </button>
                      </div>
                      <p className="notif-body">{n.body}</p>
                      {date && <span className="notif-date">{date}</span>}
                      <button
                        type="button"
                        className="receipts-toggle"
                        onClick={() => toggleReceipts(n.id)}
                      >
                        {loaded
                          ? `Entregada ${delivered}/${rows.length || 0} · Leída ${read}/${rows.length || 0}`
                          : 'Ver entregas / lecturas'}
                        {open ? ' ▴' : ' ▾'}
                      </button>
                      {open && (
                        <div className="receipts">
                          {loadingReceipts === n.id ? (
                            <div className="receipt-empty">Cargando…</div>
                          ) : rows.length === 0 ? (
                            <div className="receipt-empty">Sin destinatarios con avisos activados</div>
                          ) : (
                            rows.map((r) => (
                              <div key={r.id} className="receipt-row">
                                <span className="receipt-name">
                                  {r.clientName}{r.deviceName ? ` · ${r.deviceName}` : ''}
                                </span>
                                <span className={`receipt-pill ${r.delivered ? 'ok' : 'pending'}`}>
                                  {r.delivered ? 'Entregada' : 'No entregada'}
                                </span>
                                <span className={`receipt-pill ${r.read ? 'ok' : 'pending'}`}>
                                  {r.read ? 'Leída' : 'No leída'}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {section === 'farmatic' && (
          <>
            <h1 className="page-title">Actualizaciones Farmatic</h1>

            <form onSubmit={handleFarmaticSend} className="form-card">
              <div className="form-group">
                <label htmlFor="farmatic-version">Versión (opcional)</label>
                <input
                  id="farmatic-version"
                  type="text"
                  placeholder="Ej: 2026.09"
                  value={farmaticForm.version}
                  onChange={(e) => setFarmaticForm({ ...farmaticForm, version: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label htmlFor="farmatic-title">Título</label>
                <input
                  id="farmatic-title"
                  type="text"
                  placeholder="Ej: Mejoras en facturación"
                  value={farmaticForm.title}
                  onChange={(e) => setFarmaticForm({ ...farmaticForm, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="farmatic-body">Cambios / mejoras</label>
                <textarea
                  id="farmatic-body"
                  placeholder="Lista los cambios de esta versión..."
                  value={farmaticForm.body}
                  onChange={(e) => setFarmaticForm({ ...farmaticForm, body: e.target.value })}
                  rows={5}
                  required
                />
              </div>

              <label className="check-row">
                <input
                  type="checkbox"
                  checked={farmaticForm.notifyPush}
                  onChange={(e) => setFarmaticForm({ ...farmaticForm, notifyPush: e.target.checked })}
                />
                Avisar por push a quien tenga “Actualizaciones Farmatic” activado
              </label>

              <button type="submit" className="send-btn" disabled={farmaticSending}>
                {farmaticSending ? 'Publicando...' : 'Publicar actualización'}
              </button>

              {farmaticSuccess && <div className="success-msg">{farmaticSuccess}</div>}
            </form>

            <h2 className="section-title">Historial Farmatic</h2>

            {farmaticUpdates.length === 0 ? (
              <div className="empty">Aún no hay actualizaciones publicadas</div>
            ) : (
              <div className="timeline">
                {farmaticUpdates.map((u) => {
                  const date = u.createdAt?.toDate?.()?.toLocaleString('es-ES') || '';
                  return (
                    <div key={u.id} className="timeline-item">
                      <div className="timeline-dot" />
                      <div className="timeline-card">
                        <div className="timeline-header">
                          <div>
                            {u.version && <span className="timeline-version">{u.version}</span>}
                            <strong>{u.title}</strong>
                          </div>
                          <button
                            className="delete-btn"
                            onClick={() => handleDeleteFarmatic(u.id)}
                            title="Eliminar"
                          >
                            🗑️
                          </button>
                        </div>
                        <p className="notif-body">{u.body}</p>
                        {date && <span className="notif-date">{date}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {section === 'info' && (
          <>
            <h1 className="page-title">Información</h1>

            <form onSubmit={handleInfoSend} className="form-card">
              <div className="form-group">
                <label htmlFor="info-title">Título</label>
                <input
                  id="info-title"
                  type="text"
                  placeholder="Ej: Registro de alias SMS"
                  value={infoForm.title}
                  onChange={(e) => setInfoForm({ ...infoForm, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="info-body">Contenido</label>
                <textarea
                  id="info-body"
                  placeholder="Explica la normativa o el comunicado..."
                  value={infoForm.body}
                  onChange={(e) => setInfoForm({ ...infoForm, body: e.target.value })}
                  rows={5}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="info-pdf">PDFs adjuntos (opcional)</label>
                <p className="file-hint" style={{ marginBottom: 8 }}>
                  Puedes elegir varios a la vez (Ctrl o Cmd) o ir añadiendo con el botón.
                </p>
                <input
                  id="info-pdf"
                  key={`info-pdf-${infoForm.pdfFiles.length}-${infoSuccess || 'idle'}`}
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  onChange={(e) => {
                    const next = Array.from(e.target.files || []);
                    if (next.length === 0) return;
                    setInfoForm((prev) => {
                      const names = new Set(prev.pdfFiles.map((f) => f.name));
                      const merged = [...prev.pdfFiles];
                      next.forEach((file) => {
                        if (!names.has(file.name)) {
                          names.add(file.name);
                          merged.push(file);
                        }
                      });
                      return { ...prev, pdfFiles: merged };
                    });
                    e.target.value = '';
                  }}
                />
                {infoForm.pdfFiles.length > 0 && (
                  <ul className="pdf-file-list">
                    {infoForm.pdfFiles.map((file) => (
                      <li key={file.name} className="pdf-file-row">
                        <span>{file.name}</span>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => setInfoForm((prev) => ({
                            ...prev,
                            pdfFiles: prev.pdfFiles.filter((f) => f.name !== file.name),
                          }))}
                        >
                          Quitar
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <label className="check-row">
                <input
                  type="checkbox"
                  checked={infoForm.notifyPush}
                  onChange={(e) => setInfoForm({ ...infoForm, notifyPush: e.target.checked })}
                />
                Avisar por push a quien tenga “Información” activado
              </label>

              <button type="submit" className="send-btn" disabled={infoSending}>
                {infoSending ? 'Publicando...' : 'Publicar información'}
              </button>

              {infoSuccess && <div className="success-msg">{infoSuccess}</div>}
            </form>

            <h2 className="section-title">Historial de información</h2>

            {infoArticles.length === 0 ? (
              <div className="empty">Aún no hay artículos publicados</div>
            ) : (
              <div className="timeline">
                {infoArticles.map((u) => {
                  const date = u.createdAt?.toDate?.()?.toLocaleString('es-ES') || '';
                  return (
                    <div key={u.id} className="timeline-item">
                      <div className="timeline-dot" />
                      <div className="timeline-card">
                        <div className="timeline-header">
                          <div>
                            <strong>{u.title}</strong>
                          </div>
                          <button
                            className="delete-btn"
                            onClick={() => handleDeleteInfo(u)}
                            title="Eliminar"
                          >
                            🗑️
                          </button>
                        </div>
                        <p className="notif-body">{u.body}</p>
                        {(() => {
                          const pdfs = Array.isArray(u.pdfs) && u.pdfs.length > 0
                            ? u.pdfs
                            : (u.pdfUrl ? [{ url: u.pdfUrl, name: u.pdfName || 'documento.pdf' }] : []);
                          return pdfs.map((pdf) => (
                            <a
                              key={pdf.path || pdf.url}
                              className="pdf-link"
                              href={pdf.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              PDF: {pdf.name || 'Ver documento'}
                            </a>
                          ));
                        })()}
                        {date && <span className="notif-date">{date}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {section === 'clientes' && (
          <>
            <h1 className="page-title">Clientes</h1>

            <form onSubmit={handleCreateClient} className="form-card">
              <div className="form-group">
                <label htmlFor="client-name">Nombre del cliente</label>
                <input
                  id="client-name"
                  type="text"
                  placeholder="Ej: Farmacia Centro"
                  value={clientNameInput}
                  onChange={(e) => setClientNameInput(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="send-btn" disabled={creatingClient}>
                {creatingClient ? 'Creando…' : 'Crear cliente y generar código'}
              </button>
              {createdCode && (
                <div className="code-box">
                  <div>
                    <div className="code-label">Código de licencia</div>
                    <code className="code-value">{createdCode}</code>
                  </div>
                  <button type="button" className="copy-btn" onClick={() => copyCode(createdCode)}>
                    Copiar
                  </button>
                </div>
              )}
              {clientSuccess && <div className="success-msg">{clientSuccess}</div>}
            </form>

            <h2 className="section-title">Listado</h2>

            {clients.length === 0 ? (
              <div className="empty">Aún no hay clientes. Crea uno para generar un código.</div>
            ) : (
              <div className="client-list">
                {clients.map((client) => {
                  const stats = clientDeviceStats(client.id, deviceList);
                  const open = expandedClient === client.id;
                  return (
                    <div key={client.id} className={`client-card ${client.active ? '' : 'inactive'}`}>
                      <div className="client-header">
                        <div className="client-main">
                          <strong>{client.name}</strong>
                          <span className={`client-badge ${client.active ? 'on' : 'off'}`}>
                            {client.active ? 'Activo' : 'Inactivo'}
                          </span>
                        </div>
                        <div className="client-actions">
                          <button type="button" className="ghost-btn" onClick={() => copyCode(client.id)}>
                            Copiar código
                          </button>
                          <button type="button" className="ghost-btn" onClick={() => handleToggleClient(client)}>
                            {client.active ? 'Desactivar' : 'Activar'}
                          </button>
                          <button type="button" className="ghost-btn danger" onClick={() => handleDeleteClient(client)}>
                            Borrar
                          </button>
                        </div>
                      </div>
                      <div className="client-meta">
                        <code>{client.id}</code>
                        <span>{stats.count === 0 ? 'Sin dispositivos' : `${stats.count} dispositivo(s)`}</span>
                        <span>{formatLastSeen(stats.lastSeenAt)}</span>
                      </div>
                      <button
                        type="button"
                        className="receipts-toggle"
                        onClick={() => setExpandedClient(open ? null : client.id)}
                      >
                        {open ? 'Ocultar dispositivos ▴' : 'Ver dispositivos ▾'}
                      </button>
                      {open && (
                        <div className="client-devices">
                          {stats.devices.length === 0 ? (
                            <div className="receipt-empty">Aún no ha entrado ningún dispositivo</div>
                          ) : (
                            stats.devices.map((d) => (
                              <div key={d.id} className="client-device-row">
                                <div>
                                  <div className="device-name-dark">
                                    {deviceLabel(d)}
                                    <span className="device-platform-tag"> · {d.platform || '—'}</span>
                                  </div>
                                  <div className="device-prefs-dark">
                                    Última conexión: {formatLastSeen(
                                      d.lastSeenAt?.toMillis?.() || d.updatedAt?.toMillis?.() || 0,
                                    )}
                                    {' · '}
                                    {d.prefs?.alerts === false ? '' : 'Avisos'}
                                    {d.prefs?.alerts !== false && (d.prefs?.farmatic !== false || d.prefs?.info !== false) ? ' · ' : ''}
                                    {d.prefs?.farmatic === false ? '' : 'Farmatic'}
                                    {d.prefs?.farmatic !== false && d.prefs?.info !== false ? ' · ' : ''}
                                    {d.prefs?.info === false ? '' : 'Info'}
                                    {d.prefs?.alerts === false && d.prefs?.farmatic === false && d.prefs?.info === false ? 'Sin avisos' : ''}
                                  </div>
                                </div>
                                <button
                                  className="delete-btn"
                                  onClick={() => handleDeleteDevice(d.id)}
                                  title="Eliminar dispositivo"
                                >
                                  🗑️
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [adminOk, setAdminOk] = useState(undefined);

  useEffect(() => {
    return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    if (!user) {
      setAdminOk(undefined);
      return undefined;
    }

    let cancelled = false;
    setAdminOk(undefined);
    getDoc(doc(db, 'admins', user.uid))
      .then((snap) => {
        if (!cancelled) setAdminOk(snap.exists());
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setAdminOk(false);
      });

    return () => { cancelled = true; };
  }, [user]);

  if (user === undefined) {
    return (
      <div className="login-page">
        <div className="login-loading">Cargando…</div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  if (adminOk === undefined) {
    return (
      <div className="login-page">
        <div className="login-loading">Comprobando acceso…</div>
      </div>
    );
  }

  if (!adminOk) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-brand">
            <span className="login-logo">TAEMSA</span>
            <span className="login-sub">Sin permiso de administrador</span>
          </div>
          <p className="login-error">
            Tu usuario no está en la lista de admins. En Firebase Console crea el
            documento <code>admins/{user.uid}</code> (puede ir vacío) y vuelve a entrar.
          </p>
          <div className="form-group">
            <label>Tu UID</label>
            <input type="text" value={user.uid} readOnly />
          </div>
          <button type="button" className="send-btn" onClick={() => signOut(auth)}>
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  return <AdminPanel user={user} />;
}
