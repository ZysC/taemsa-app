import { useEffect, useRef, useState } from 'react';
import {
  collection, onSnapshot, orderBy, query,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  loadClientName,
  saveClientName,
  registerDevice,
  markNotificationDelivered,
  markNotificationRead,
} from './clientApi';
import { enableWebPush, listenForegroundMessages } from './webPush';
import './App.css';

const TYPE_COLORS = {
  error:         { bg: '#FEE2E2', border: '#EF4444', icon: '🔴' },
  problema:      { bg: '#FEF3C7', border: '#F59E0B', icon: '⚠️' },
  actualizacion: { bg: '#DBEAFE', border: '#3B82F6', icon: '🔵' },
  novedad:       { bg: '#D1FAE5', border: '#10B981', icon: '🟢' },
  info:          { bg: '#F3F4F6', border: '#6B7280', icon: 'ℹ️' },
};

export default function App() {
  const [checkingName, setCheckingName] = useState(true);
  const [clientName, setClientName] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [deviceStatus, setDeviceStatus] = useState('');
  const [pushReady, setPushReady] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);
  const [pushError, setPushError] = useState('');
  const [toast, setToast] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const deliveredIds = useRef(new Set());

  useEffect(() => {
    const name = loadClientName();
    if (name) setClientName(name);
    setCheckingName(false);
  }, []);

  useEffect(() => {
    if (!clientName) return undefined;

    let cancelled = false;
    setDeviceStatus('Registrando…');

    registerDevice(clientName)
      .then((id) => {
        if (!cancelled) {
          setDeviceId(id);
          setDeviceStatus(`${clientName} · Web`);
        }
      })
      .catch((err) => {
        if (!cancelled) setDeviceStatus('Error al registrar: ' + (err?.message || 'desconocido'));
      });

    const q = query(collection(db, 'notifications'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setNotifications(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
      },
    );

    let unsubMsg = () => {};
    listenForegroundMessages((payload) => {
      const title = payload.notification?.title || 'TAEMSA';
      const body = payload.notification?.body || '';
      setToast(`${title}: ${body}`);
      setTimeout(() => setToast(''), 5000);
    }).then((unsubFn) => {
      unsubMsg = unsubFn || (() => {});
    });

    return () => {
      cancelled = true;
      unsub();
      unsubMsg();
    };
  }, [clientName]);

  useEffect(() => {
    if (!deviceId || !clientName || notifications.length === 0) return;

    notifications.forEach((item) => {
      if (deliveredIds.current.has(item.id)) return;
      if (item.receipts?.[deviceId]?.deliveredAt) {
        deliveredIds.current.add(item.id);
        return;
      }
      deliveredIds.current.add(item.id);
      markNotificationDelivered({
        notificationId: item.id,
        deviceId,
        clientName,
      }).catch(() => {
        deliveredIds.current.delete(item.id);
      });
    });
  }, [notifications, deviceId, clientName]);

  const handleSaveClient = async (e) => {
    e?.preventDefault?.();
    const name = nameInput.trim();
    if (!name || savingName) return;
    setSavingName(true);
    saveClientName(name);
    setClientName(name);
    setSavingName(false);
  };

  const handleEnablePush = async () => {
    setPushError('');
    setEnablingPush(true);
    try {
      const token = await enableWebPush();
      const id = await registerDevice(clientName, token);
      setDeviceId(id);
      setPushReady(true);
      setDeviceStatus(`${clientName} · Push activo`);
    } catch (err) {
      setPushError(err?.message || 'No se pudo activar el push');
      setDeviceStatus(`${clientName} · Sin push`);
    } finally {
      setEnablingPush(false);
    }
  };

  const handleRead = (item) => {
    if (!deviceId || item.receipts?.[deviceId]?.readAt) return;
    markNotificationRead({
      notificationId: item.id,
      deviceId,
      clientName,
    }).catch(() => {});
  };

  const unreadCount = deviceId
    ? notifications.filter((n) => !n.receipts?.[deviceId]?.readAt).length
    : 0;

  if (checkingName) {
    return (
      <div className="app">
        <div className="loading">Cargando…</div>
      </div>
    );
  }

  if (!clientName) {
    return (
      <div className="app">
        <header className="header">
          <h1>TAEMSA</h1>
          <p>Registro de cliente</p>
        </header>
        <form className="register" onSubmit={handleSaveClient}>
          <h2>Nombre del cliente</h2>
          <p className="hint">Así el panel sabrá de quién es este dispositivo.</p>
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="Ej: Dirección"
            autoFocus
            required
          />
          <button type="submit" disabled={!nameInput.trim() || savingName}>
            {savingName ? 'Guardando…' : 'Continuar'}
          </button>
          <p className="install-hint">
            En iPhone: Safari → Compartir → <strong>Añadir a pantalla de inicio</strong>.
            Luego abre el icono y pulsa <strong>Activar avisos</strong>.
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <h1>TAEMSA</h1>
        <p>Centro de Notificaciones</p>
        <span className="status">{deviceStatus}</span>
        {unreadCount > 0 && (
          <div className="unread-pill">
            {unreadCount === 1 ? '1 aviso sin leer' : `${unreadCount} avisos sin leer`}
          </div>
        )}
      </header>

      <main className="main">
        {!pushReady && (
          <div className="push-box">
            <p>
              Para recibir avisos con el iPhone cerrado o en segundo plano,
              activa las notificaciones (debe estar añadida a inicio).
            </p>
            <button type="button" onClick={handleEnablePush} disabled={enablingPush}>
              {enablingPush ? 'Activando…' : 'Activar avisos push'}
            </button>
            {pushError && <div className="push-error">{pushError}</div>}
          </div>
        )}

        {toast && <div className="toast">{toast}</div>}

        {loading ? (
          <div className="loading">Cargando avisos…</div>
        ) : notifications.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">🔔</div>
            <h2>No hay notificaciones</h2>
            <p>Te avisaremos cuando haya novedades</p>
          </div>
        ) : (
          <div className="list">
            {notifications.map((item) => {
              const type = TYPE_COLORS[item.type] || TYPE_COLORS.info;
              const date = item.createdAt?.toDate?.()?.toLocaleString('es-ES') || '';
              const read = !!item.receipts?.[deviceId]?.readAt;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`card ${read ? 'read' : 'unread'}`}
                  style={{ backgroundColor: type.bg, borderLeftColor: type.border }}
                  onClick={() => handleRead(item)}
                >
                  <div className="card-header">
                    <span>{type.icon}</span>
                    <strong>{item.title}</strong>
                    {!read ? (
                      <span className="badge">Sin leer</span>
                    ) : (
                      <span className="read-label">Leída</span>
                    )}
                  </div>
                  <p>{item.body}</p>
                  <div className="card-footer">
                    <span>{date}</span>
                    {!read && <span className="tap-hint">Toca para marcar como leída</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
