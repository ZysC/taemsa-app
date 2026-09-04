import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import {
  collection, onSnapshot, orderBy,
  query, deleteDoc,
} from 'firebase/firestore';
import {
  createNotificationWithReceipts,
  createFarmaticUpdate,
  deleteFarmaticUpdate,
  sendExpoPushes,
} from './sendPush';
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
  return Object.entries(receipts || {}).map(([id, r]) => ({
    id,
    clientName: r.clientName || id,
    delivered: !!(r.deliveredAt),
    read: !!(r.readAt),
  }));
}

function AdminPanel({ user }) {
  const [section, setSection] = useState('avisos');
  const [form, setForm] = useState({ title: '', body: '', type: 'info' });
  const [farmaticForm, setFarmaticForm] = useState({
    version: '', title: '', body: '', notifyPush: true,
  });
  const [notifications, setNotifications] = useState([]);
  const [farmaticUpdates, setFarmaticUpdates] = useState([]);
  const [sending, setSending] = useState(false);
  const [farmaticSending, setFarmaticSending] = useState(false);
  const [deviceList, setDeviceList] = useState([]);
  const [pushDevices, setPushDevices] = useState(0);
  const [success, setSuccess] = useState('');
  const [farmaticSuccess, setFarmaticSuccess] = useState('');
  const [openReceipts, setOpenReceipts] = useState(null);
  const [devicesOpen, setDevicesOpen] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'notifications'), orderBy('createdAt', 'desc')),
      (snap) => setNotifications(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    );

    const unsubFarmatic = onSnapshot(
      query(collection(db, 'farmaticUpdates'), orderBy('createdAt', 'desc')),
      (snap) => setFarmaticUpdates(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
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

    return () => { unsub(); unsubFarmatic(); unsub2(); };
  }, []);

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
    await deleteDoc(doc(db, 'notifications', id));
  };

  const handleDeleteFarmatic = async (id) => {
    if (!confirm('¿Eliminar esta actualización Farmatic?')) return;
    await deleteFarmaticUpdate(id);
  };

  const handleDeleteDevice = async (id) => {
    if (!confirm('¿Eliminar este dispositivo?')) return;
    await deleteDoc(doc(db, 'devices', id));
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
                deviceList.map((d) => (
                  <div key={d.id} className="device-row">
                    <div className="device-info">
                      <span className="device-name">{d.clientName || d.id}</span>
                      <span className="device-prefs">
                        {d.prefs?.alerts === false ? '' : 'Avisos'}
                        {d.prefs?.alerts !== false && d.prefs?.farmatic !== false ? ' · ' : ''}
                        {d.prefs?.farmatic === false ? '' : 'Farmatic'}
                        {d.prefs?.alerts === false && d.prefs?.farmatic === false ? 'Sin avisos' : ''}
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
                ))
              )}
            </div>
          )}
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

        <div className="sidebar-footer">
          <div className="admin-email" title={user.email}>{user.email}</div>
          <button type="button" className="logout-btn" onClick={() => signOut(auth)}>
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="main">
        {section === 'avisos' ? (
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
                  const rows = receiptList(n.receipts);
                  const delivered = rows.filter((r) => r.delivered).length;
                  const read = rows.filter((r) => r.read).length;
                  const open = openReceipts === n.id;
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
                        onClick={() => setOpenReceipts(open ? null : n.id)}
                      >
                        Entregada {delivered}/{rows.length || 0} · Leída {read}/{rows.length || 0}
                        {open ? ' ▴' : ' ▾'}
                      </button>
                      {open && (
                        <div className="receipts">
                          {rows.length === 0 ? (
                            <div className="receipt-empty">Sin destinatarios con avisos activados</div>
                          ) : (
                            rows.map((r) => (
                              <div key={r.id} className="receipt-row">
                                <span className="receipt-name">{r.clientName}</span>
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
        ) : (
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
