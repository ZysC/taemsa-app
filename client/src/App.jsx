import { useEffect, useRef, useState } from 'react';
import {
  collection, onSnapshot, orderBy, query,
} from 'firebase/firestore';
import { db, ensureAppAuth } from './firebase';
import {
  loadClientName,
  saveClientName,
  loadPrefs,
  registerDevice,
  updateDevicePrefs,
  markNotificationDelivered,
  markNotificationRead,
  DEFAULT_PREFS,
} from './clientApi';
import { enableWebPush, restoreWebPush, listenForegroundMessages } from './webPush';
import { setWebAppBadge } from './appBadge';
import './App.css';

const TYPE_COLORS = {
  error:    { bg: '#FEE2E2', border: '#EF4444', icon: '🔴' },
  problema: { bg: '#FEF3C7', border: '#F59E0B', icon: '⚠️' },
  novedad:  { bg: '#D1FAE5', border: '#10B981', icon: '🟢' },
  info:     { bg: '#F3F4F6', border: '#6B7280', icon: 'ℹ️' },
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
  const [farmaticUpdates, setFarmaticUpdates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [farmaticLoading, setFarmaticLoading] = useState(true);
  const [tab, setTab] = useState('avisos');
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const deliveredIds = useRef(new Set());
  const tokenRef = useRef(null);

  useEffect(() => {
    const name = loadClientName();
    const loadedPrefs = loadPrefs();
    if (name) setClientName(name);
    setPrefs(loadedPrefs);
    setCheckingName(false);

    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'farmatic') setTab('farmatic');
  }, []);

  useEffect(() => {
    if (!clientName) return undefined;

    let cancelled = false;
    let unsub = () => {};
    let unsubFarmatic = () => {};
    let unsubMsg = () => {};
    setDeviceStatus('Registrando…');

    (async () => {
      try {
        await ensureAppAuth();
      } catch (err) {
        if (!cancelled) {
          setDeviceStatus('Error de acceso: activa Anonymous Auth en Firebase');
          console.error(err);
        }
        return;
      }
      if (cancelled) return;

      try {
        const existingToken = await restoreWebPush();
        if (cancelled) return;

        if (existingToken) {
          tokenRef.current = existingToken;
          const id = await registerDevice(clientName, existingToken, prefs);
          if (!cancelled) {
            setDeviceId(id);
            setPushReady(true);
            setDeviceStatus(`${clientName} · Push activo`);
          }
        } else {
          const id = await registerDevice(clientName, null, prefs);
          if (!cancelled) {
            setDeviceId(id);
            setPushReady(false);
            setDeviceStatus(`${clientName} · Web`);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setDeviceStatus('Error al registrar: ' + (err?.message || 'desconocido'));
        }
      }

      unsub = onSnapshot(
        query(collection(db, 'notifications'), orderBy('createdAt', 'desc')),
        (snap) => {
          setNotifications(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          setLoading(false);
        },
        (err) => {
          console.error(err);
          setLoading(false);
        },
      );

      unsubFarmatic = onSnapshot(
        query(collection(db, 'farmaticUpdates'), orderBy('createdAt', 'desc')),
        (snap) => {
          setFarmaticUpdates(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          setFarmaticLoading(false);
        },
        (err) => {
          console.error(err);
          setFarmaticLoading(false);
        },
      );

      listenForegroundMessages((payload) => {
        const title = payload.notification?.title || payload.data?.title || 'TAEMSA';
        const body = payload.notification?.body || payload.data?.body || '';
        setToast(`${title}: ${body}`);
        setTimeout(() => setToast(''), 5000);
      }).then((unsubFn) => {
        unsubMsg = unsubFn || (() => {});
      });
    })();

    return () => {
      cancelled = true;
      unsub();
      unsubFarmatic();
      unsubMsg();
    };
  }, [clientName]);

  useEffect(() => {
    if (!deviceId || !clientName || !prefs.alerts || notifications.length === 0) return;

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
  }, [notifications, deviceId, clientName, prefs.alerts]);

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
      tokenRef.current = token;
      const id = await registerDevice(clientName, token, prefs);
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

  const handlePrefChange = async (key, value) => {
    if (!deviceId || savingPrefs) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setSavingPrefs(true);
    try {
      await updateDevicePrefs(deviceId, next);
      await registerDevice(clientName, tokenRef.current, next);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingPrefs(false);
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

  const unreadCount = deviceId && prefs.alerts
    ? notifications.filter((n) => !n.receipts?.[deviceId]?.readAt).length
    : 0;

  useEffect(() => {
    setWebAppBadge(unreadCount);
  }, [unreadCount]);

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
        <p>Soporte Farmatic</p>
        <span className="status">{deviceStatus}</span>
        {unreadCount > 0 && (
          <div className="unread-pill">
            {unreadCount === 1 ? '1 aviso sin leer' : `${unreadCount} avisos sin leer`}
          </div>
        )}
      </header>

      <nav className="tabs">
        <button type="button" className={tab === 'avisos' ? 'active' : ''} onClick={() => setTab('avisos')}>
          Avisos
        </button>
        <button type="button" className={tab === 'farmatic' ? 'active' : ''} onClick={() => setTab('farmatic')}>
          Farmatic
        </button>
        <button type="button" className={tab === 'prefs' ? 'active' : ''} onClick={() => setTab('prefs')}>
          Preferencias
        </button>
      </nav>

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

        {tab === 'avisos' && (
          !prefs.alerts ? (
            <div className="empty">
              <h2>Avisos desactivados</h2>
              <p>Actívalos en Preferencias si quieres recibirlos</p>
            </div>
          ) : loading ? (
            <div className="loading">Cargando avisos…</div>
          ) : notifications.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">🔔</div>
              <h2>No hay avisos</h2>
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
          )
        )}

        {tab === 'farmatic' && (
          !prefs.farmatic ? (
            <div className="empty">
              <h2>Actualizaciones Farmatic desactivadas</h2>
              <p>Actívalas en Preferencias si quieres verlas</p>
            </div>
          ) : farmaticLoading ? (
            <div className="loading">Cargando historial…</div>
          ) : farmaticUpdates.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">📋</div>
              <h2>Sin actualizaciones</h2>
              <p>Aquí verás el historial de Farmatic</p>
            </div>
          ) : (
            <div className="timeline">
              {farmaticUpdates.map((item) => {
                const date = item.createdAt?.toDate?.()?.toLocaleString('es-ES') || '';
                return (
                  <div key={item.id} className="timeline-item">
                    <div className="timeline-dot" />
                    <div className="timeline-card">
                      {item.version && <span className="version">{item.version}</span>}
                      <strong>{item.title}</strong>
                      <p>{item.body}</p>
                      {date && <span className="date">{date}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {tab === 'prefs' && (
          <div className="prefs">
            <h2>Qué quieres recibir</h2>
            <p className="hint">Por defecto ambos están activos. Puedes dejar solo uno o ninguno.</p>

            <label className="pref-row">
              <div>
                <strong>Avisos de soporte</strong>
                <span>Incidencias, novedades e información</span>
              </div>
              <input
                type="checkbox"
                checked={prefs.alerts}
                disabled={savingPrefs}
                onChange={(e) => handlePrefChange('alerts', e.target.checked)}
              />
            </label>

            <label className="pref-row">
              <div>
                <strong>Actualizaciones Farmatic</strong>
                <span>Historial y avisos de nuevas versiones</span>
              </div>
              <input
                type="checkbox"
                checked={prefs.farmatic}
                disabled={savingPrefs}
                onChange={(e) => handlePrefChange('farmatic', e.target.checked)}
              />
            </label>
          </div>
        )}
      </main>
    </div>
  );
}
