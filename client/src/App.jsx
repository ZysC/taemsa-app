import { useEffect, useRef, useState } from 'react';
import {
  collection, collectionGroup, onSnapshot, orderBy, query, where,
} from 'firebase/firestore';
import { auth, db, ensureAppAuth } from './firebase';
import {
  ensureActiveSession,
  redeemClientCode,
  saveDeviceNameOnly,
  clearSession,
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
  const [checkingSession, setCheckingSession] = useState(true);
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [deviceNameInput, setDeviceNameInput] = useState('');
  const [codeError, setCodeError] = useState('');
  const [savingCode, setSavingCode] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [deviceStatus, setDeviceStatus] = useState('');
  const [pushReady, setPushReady] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);
  const [pushError, setPushError] = useState('');
  const [toast, setToast] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [farmaticUpdates, setFarmaticUpdates] = useState([]);
  const [infoArticles, setInfoArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [farmaticLoading, setFarmaticLoading] = useState(true);
  const [infoLoading, setInfoLoading] = useState(true);
  const [tab, setTab] = useState('avisos');
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [myReceipts, setMyReceipts] = useState({});
  const deliveredIds = useRef(new Set());
  const tokenRef = useRef(null);

  useEffect(() => {
    const loadedPrefs = loadPrefs();
    setPrefs(loadedPrefs);

    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'farmatic') setTab('farmatic');
    if (params.get('tab') === 'info') setTab('info');

    ensureActiveSession()
      .then((session) => {
        if (session) {
          setClientId(session.clientId);
          setClientName(session.clientName);
          setDeviceId(session.deviceId);
          setDeviceName(session.deviceName || '');
        }
      })
      .finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    if (!clientId || !clientName || !deviceId || !deviceName) return undefined;

    let cancelled = false;
    let unsub = () => {};
    let unsubFarmatic = () => {};
    let unsubInfo = () => {};
    let unsubReceipts = () => {};
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
          const id = await registerDevice({
            clientId,
            clientName,
            deviceId,
            deviceName,
            token: existingToken,
            prefs,
          });
          if (!cancelled) {
            setDeviceId(id);
            setPushReady(true);
            setDeviceStatus(`${clientName} · ${deviceName}`);
          }
        } else {
          const id = await registerDevice({
            clientId,
            clientName,
            deviceId,
            deviceName,
            token: null,
            prefs,
          });
          if (!cancelled) {
            setDeviceId(id);
            setPushReady(false);
            setDeviceStatus(`${clientName} · ${deviceName}`);
          }
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err?.message || 'desconocido';
          // No borrar sesión por errores de permiso/red al sincronizar dispositivo.
          if (/no válido|desactiv/i.test(msg) && !/permission|insufficient/i.test(msg)) {
            clearSession();
            setClientId('');
            setClientName('');
            setDeviceId('');
            setCodeError('Código inválido o desactivado. Introduce uno nuevo.');
          } else {
            setDeviceStatus(
              /permission|insufficient/i.test(msg)
                ? 'No se pudo sincronizar el dispositivo. Reabre o contacta con TAEMSA.'
                : 'Error al registrar: ' + msg,
            );
          }
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

      unsubInfo = onSnapshot(
        query(collection(db, 'infoArticles'), orderBy('createdAt', 'desc')),
        (snap) => {
          setInfoArticles(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          setInfoLoading(false);
        },
        (err) => {
          console.error(err);
          setInfoLoading(false);
        },
      );

      if (auth.currentUser?.uid) {
        unsubReceipts = onSnapshot(
          query(collectionGroup(db, 'receipts'), where('uid', '==', auth.currentUser.uid)),
          (snap) => {
            const map = {};
            snap.docs.forEach((d) => {
              const notificationId = d.ref.parent.parent?.id;
              if (notificationId) map[notificationId] = d.data();
            });
            setMyReceipts(map);
          },
          (err) => console.error(err),
        );
      }

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
      unsubInfo();
      unsubReceipts();
      unsubMsg();
    };
  }, [clientId, clientName, deviceId, deviceName]);

  useEffect(() => {
    if (!deviceId || !clientName || !prefs.alerts || notifications.length === 0) return;

    notifications.forEach((item) => {
      if (deliveredIds.current.has(item.id)) return;
      if (myReceipts[item.id]?.deliveredAt) {
        deliveredIds.current.add(item.id);
        return;
      }
      deliveredIds.current.add(item.id);
      markNotificationDelivered({
        notificationId: item.id,
        deviceId,
        clientName,
        deviceName,
      }).catch(() => {
        deliveredIds.current.delete(item.id);
      });
    });
  }, [notifications, deviceId, clientName, deviceName, prefs.alerts, myReceipts]);

  const handleRedeemCode = async (e) => {
    e?.preventDefault?.();
    if (!codeInput.trim() || !deviceNameInput.trim() || savingCode) return;
    setSavingCode(true);
    setCodeError('');
    try {
      const { client, deviceId: id, deviceName: name } = await redeemClientCode(
        codeInput,
        deviceNameInput,
      );
      setClientId(client.id);
      setClientName(client.name);
      setDeviceId(id);
      setDeviceName(name);
      setCodeInput('');
      setDeviceNameInput('');
    } catch (err) {
      setCodeError(err?.message || 'No se pudo validar el código');
    } finally {
      setSavingCode(false);
    }
  };

  const handleSaveDeviceName = async (e) => {
    e?.preventDefault?.();
    if (!deviceNameInput.trim() || savingCode) return;
    setSavingCode(true);
    setCodeError('');
    try {
      const name = await saveDeviceNameOnly(deviceNameInput);
      setDeviceName(name);
      setDeviceNameInput('');
    } catch (err) {
      setCodeError(err?.message || 'No se pudo guardar el nombre');
    } finally {
      setSavingCode(false);
    }
  };

  const handleEnablePush = async () => {
    setPushError('');
    setEnablingPush(true);
    try {
      const token = await enableWebPush();
      tokenRef.current = token;
      const id = await registerDevice({
        clientId,
        clientName,
        deviceId,
        deviceName,
        token,
        prefs,
      });
      setDeviceId(id);
      setPushReady(true);
      setDeviceStatus(`${clientName} · ${deviceName}`);
    } catch (err) {
      setPushError(err?.message || 'No se pudieron activar las notificaciones');
      setDeviceStatus(`${clientName} · ${deviceName}`);
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
      await updateDevicePrefs(deviceId, next, { clientId, clientName, deviceName });
      await registerDevice({
        clientId,
        clientName,
        deviceId,
        deviceName,
        token: tokenRef.current,
        prefs: next,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleRead = (item) => {
    if (!deviceId || myReceipts[item.id]?.readAt) return;
    const prev = myReceipts[item.id];
    setMyReceipts((map) => ({
      ...map,
      [item.id]: { ...map[item.id], readAt: new Date() },
    }));
    markNotificationRead({
      notificationId: item.id,
      deviceId,
      clientName,
      deviceName,
    }).catch((err) => {
      console.error('No se pudo marcar leído:', err);
      setMyReceipts((map) => {
        const next = { ...map };
        if (prev) next[item.id] = prev;
        else delete next[item.id];
        return next;
      });
    });
  };

  const unreadCount = deviceId && prefs.alerts
    ? notifications.filter((n) => !myReceipts[n.id]?.readAt).length
    : 0;

  useEffect(() => {
    setWebAppBadge(unreadCount);
  }, [unreadCount]);

  if (checkingSession) {
    return (
      <div className="app">
        <div className="loading">Cargando…</div>
      </div>
    );
  }

  if (!clientId || !clientName || !deviceId) {
    return (
      <div className="app">
        <header className="header">
          <h1>TAEMSA</h1>
          <p>Acceso de cliente</p>
        </header>
        <form className="register" onSubmit={handleRedeemCode}>
          <h2>Código de cliente</h2>
          <p className="hint">
            Introduce el código que te ha facilitado TAEMSA (ej. TAEM-7K2Q9M)
            y un nombre para reconocer este dispositivo.
          </p>
          <input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            placeholder="Código: TAEM-XXXXXX"
            autoFocus
            autoCapitalize="characters"
            spellCheck={false}
            required
          />
          <input
            value={deviceNameInput}
            onChange={(e) => setDeviceNameInput(e.target.value)}
            placeholder="Nombre del dispositivo (ej. PC recepción)"
            required
          />
          {codeError && <div className="push-error">{codeError}</div>}
          <button type="submit" disabled={!codeInput.trim() || !deviceNameInput.trim() || savingCode}>
            {savingCode ? 'Validando…' : 'Continuar'}
          </button>
          <p className="install-hint">
            En iPhone: Safari → Compartir → <strong>Añadir a pantalla de inicio</strong>.
            Luego abre el icono y pulsa <strong>Activar avisos</strong>.
          </p>
        </form>
      </div>
    );
  }

  if (!deviceName) {
    return (
      <div className="app">
        <header className="header">
          <h1>TAEMSA</h1>
          <p>{clientName}</p>
        </header>
        <form className="register" onSubmit={handleSaveDeviceName}>
          <h2>Nombre de este dispositivo</h2>
          <p className="hint">
            Así en el panel de TAEMSA sabremos de cuál se trata (ej. iPhone Ana, PC mostrador).
          </p>
          <input
            value={deviceNameInput}
            onChange={(e) => setDeviceNameInput(e.target.value)}
            placeholder="Ej: PC recepción"
            autoFocus
            required
          />
          {codeError && <div className="push-error">{codeError}</div>}
          <button type="submit" disabled={!deviceNameInput.trim() || savingCode}>
            {savingCode ? 'Guardando…' : 'Continuar'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-top">
          <div className="header-copy">
            <h1>TAEMSA</h1>
            <p>{tab === 'prefs' ? 'Preferencias' : 'Soporte Farmatic'}</p>
          </div>
          {tab === 'prefs' ? (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setTab('avisos')}
              aria-label="Volver"
              title="Volver"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setTab('prefs')}
              aria-label="Ajustes"
              title="Ajustes"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="M19.4 13a7.8 7.8 0 0 0 .05-2l2.05-1.6-2-3.46-2.45.8a7.7 7.7 0 0 0-1.73-1L15 3.5h-4l-.37 2.64a7.7 7.7 0 0 0-1.73 1l-2.45-.8-2 3.46L6.55 11a7.8 7.8 0 0 0 0 2l-2.05 1.6 2 3.46 2.45-.8a7.7 7.7 0 0 0 1.73 1L11 20.5h4l.37-2.64a7.7 7.7 0 0 0 1.73-1l2.45.8 2-3.46L19.4 13Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
        {tab !== 'prefs' && (
          <>
            <div className="status-row">
              <span className="status">{deviceStatus}</span>
              <span
                className={`notif-badge ${pushReady ? 'on' : 'off'}`}
                title={pushReady ? 'Notificaciones activas' : 'Notificaciones desactivadas'}
                aria-label={pushReady ? 'Notificaciones activas' : 'Notificaciones desactivadas'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22Zm7-6.2V11a7 7 0 1 0-14 0v4.8L3 17.8V19h18v-1.2l-2-2Z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                  {!pushReady && (
                    <path
                      d="M4 4l16 16"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  )}
                </svg>
              </span>
            </div>
            {unreadCount > 0 && (
              <div className="unread-pill">
                {unreadCount === 1 ? '1 aviso sin leer' : `${unreadCount} avisos sin leer`}
              </div>
            )}
          </>
        )}
      </header>

      {tab !== 'prefs' && (
        <nav className="tabs">
          <button type="button" className={tab === 'avisos' ? 'active' : ''} onClick={() => setTab('avisos')}>
            Avisos
          </button>
          <button type="button" className={tab === 'farmatic' ? 'active' : ''} onClick={() => setTab('farmatic')}>
            Farmatic
          </button>
          <button type="button" className={tab === 'info' ? 'active' : ''} onClick={() => setTab('info')}>
            Información
          </button>
        </nav>
      )}

      <main className="main">
        {!pushReady && (
          <div className="push-box">
            <p>
              Para recibir avisos con el iPhone cerrado o en segundo plano,
              activa las notificaciones (debe estar añadida a inicio).
            </p>
            <button type="button" onClick={handleEnablePush} disabled={enablingPush}>
              {enablingPush ? 'Activando…' : 'Activar notificaciones'}
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
                const read = !!myReceipts[item.id]?.readAt;
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

        {tab === 'info' && (
          !prefs.info ? (
            <div className="empty">
              <h2>Información desactivada</h2>
              <p>Actívala en Preferencias si quieres verla</p>
            </div>
          ) : infoLoading ? (
            <div className="loading">Cargando información…</div>
          ) : infoArticles.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">📄</div>
              <h2>Sin información</h2>
              <p>Aquí verás normativas y guías</p>
            </div>
          ) : (
            <div className="timeline">
              {infoArticles.map((item) => {
                const date = item.createdAt?.toDate?.()?.toLocaleString('es-ES') || '';
                return (
                  <div key={item.id} className="timeline-item">
                    <div className="timeline-dot" />
                    <div className="timeline-card">
                      <strong>{item.title}</strong>
                      <p>{item.body}</p>
                      {(() => {
                        const pdfs = Array.isArray(item.pdfs) && item.pdfs.length > 0
                          ? item.pdfs.filter((p) => p?.url)
                          : (item.pdfUrl ? [{ url: item.pdfUrl, name: item.pdfName || '' }] : []);
                        if (pdfs.length === 0) return null;
                        return (
                          <div className="pdf-list">
                            {pdfs.map((pdf, idx) => (
                              <a
                                key={pdf.path || `${pdf.url}-${idx}`}
                                className="pdf-link"
                                href={pdf.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {pdfs.length > 1
                                  ? `Abrir PDF ${idx + 1}${pdf.name ? `: ${pdf.name}` : ''}`
                                  : `Abrir PDF${pdf.name ? `: ${pdf.name}` : ''}`}
                              </a>
                            ))}
                          </div>
                        );
                      })()}
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
            <p className="hint">Por defecto todo está activo. Puedes desactivar lo que no necesites.</p>

            <label className="pref-row">
              <div>
                <strong>Avisos de soporte</strong>
                <span>Incidencias, problemas y avisos puntuales</span>
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

            <label className="pref-row">
              <div>
                <strong>Información</strong>
                <span>Normativas, comunicados y guías</span>
              </div>
              <input
                type="checkbox"
                checked={prefs.info}
                disabled={savingPrefs}
                onChange={(e) => handlePrefChange('info', e.target.checked)}
              />
            </label>
          </div>
        )}
      </main>
    </div>
  );
}
