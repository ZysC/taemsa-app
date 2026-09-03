import { useEffect, useState } from 'react';
import { db } from './firebase';
import {
  collection, addDoc, onSnapshot, orderBy,
  query, serverTimestamp, deleteDoc, doc,
} from 'firebase/firestore';
import './App.css';

const TYPES = [
  { value: 'info',          label: 'ℹ️  Información',   color: '#6B7280' },
  { value: 'novedad',       label: '🟢 Novedad',         color: '#10B981' },
  { value: 'actualizacion', label: '🔵 Actualización',   color: '#3B82F6' },
  { value: 'problema',      label: '⚠️  Problema',        color: '#F59E0B' },
  { value: 'error',         label: '🔴 Error / Urgente', color: '#EF4444' },
];

const TYPE_STYLES = {
  error:         { bg: '#FEE2E2', border: '#EF4444', badge: '#EF4444' },
  problema:      { bg: '#FEF3C7', border: '#F59E0B', badge: '#F59E0B' },
  actualizacion: { bg: '#DBEAFE', border: '#3B82F6', badge: '#3B82F6' },
  novedad:       { bg: '#D1FAE5', border: '#10B981', badge: '#10B981' },
  info:          { bg: '#F3F4F6', border: '#6B7280', badge: '#6B7280' },
};

const TYPE_ICONS = {
  error: '🔴', problema: '⚠️', actualizacion: '🔵', novedad: '🟢', info: 'ℹ️',
};

export default function App() {
  const [form, setForm] = useState({ title: '', body: '', type: 'info' });
  const [notifications, setNotifications] = useState([]);
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [devices, setDevices] = useState(0);

  useEffect(() => {
    const q = query(collection(db, 'notifications'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setNotifications(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const unsub2 = onSnapshot(collection(db, 'devices'), (snap) => {
      setDevices(snap.size);
    });

    return () => { unsub(); unsub2(); };
  }, []);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) return;
    setSending(true);
    try {
      await addDoc(collection(db, 'notifications'), {
        ...form,
        createdAt: serverTimestamp(),
      });
      setForm({ title: '', body: '', type: 'info' });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      alert('Error al enviar: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar esta notificación?')) return;
    await deleteDoc(doc(db, 'notifications', id));
  };

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-text">TAEMSA</span>
          <span className="logo-sub">Panel de Notificaciones</span>
        </div>

        <div className="stat-box">
          <span className="stat-number">{devices}</span>
          <span className="stat-label">Dispositivos registrados</span>
        </div>

        <div className="stat-box">
          <span className="stat-number">{notifications.length}</span>
          <span className="stat-label">Notificaciones enviadas</span>
        </div>
      </aside>

      {/* Main content */}
      <main className="main">
        <h1 className="page-title">Enviar Notificación</h1>

        {/* Formulario */}
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
              placeholder="Describe el problema, novedad o actualización..."
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              rows={4}
              required
            />
          </div>

          <button type="submit" className="send-btn" disabled={sending}>
            {sending ? 'Enviando...' : '📤 Enviar a todos los dispositivos'}
          </button>

          {success && (
            <div className="success-msg">
              ✅ Notificación enviada correctamente a {devices} dispositivos
            </div>
          )}
        </form>

        {/* Historial */}
        <h2 className="section-title">Historial de Notificaciones</h2>

        {notifications.length === 0 ? (
          <div className="empty">Aún no hay notificaciones enviadas</div>
        ) : (
          <div className="notif-list">
            {notifications.map((n) => {
              const s = TYPE_STYLES[n.type] || TYPE_STYLES.info;
              const icon = TYPE_ICONS[n.type] || 'ℹ️';
              const date = n.createdAt?.toDate?.()?.toLocaleString('es-ES') || '';
              return (
                <div
                  key={n.id}
                  className="notif-card"
                  style={{ backgroundColor: s.bg, borderLeftColor: s.border }}
                >
                  <div className="notif-header">
                    <span>{icon}</span>
                    <strong>{n.title}</strong>
                    <span
                      className="notif-badge"
                      style={{ backgroundColor: s.badge }}
                    >
                      {n.type}
                    </span>
                    <button
                      className="delete-btn"
                      onClick={() => handleDelete(n.id)}
                      title="Eliminar"
                    >
                      🗑️
                    </button>
                  </div>
                  <p className="notif-body">{n.body}</p>
                  {date && <span className="notif-date">{date}</span>}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
