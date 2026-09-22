import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet, Text, View, FlatList, TextInput, Pressable, Switch, Image,
  Platform, StatusBar, ActivityIndicator, RefreshControl, KeyboardAvoidingView, Linking,
  ScrollView,
} from 'react-native';
import Constants from 'expo-constants';
import { db, ensureAppAuth } from './firebase';
import {
  collection, doc, onSnapshot, orderBy, query,
} from 'firebase/firestore';
import {
  ensureActiveSession,
  redeemClientCode,
  saveDeviceNameOnly,
  registerDevice,
  updateDevicePrefs,
} from './registerDevice';
import { markNotificationDelivered, markNotificationRead } from './receipts';
import {
  createT3Ticket,
  fetchClientSupportEmail,
  fetchMyT3Tickets,
} from './t3Api';
import { DEFAULT_PREFS } from './prefs';
import { loadPrefs, savePrefs } from './prefsStorage';
import { loadReceiptsCache, saveReceiptsCache } from './receiptsCache';
import { setAppIconBadge } from './badge';
import { clearSession } from './clientSession';
import { ensureAppCheck } from './appCheck';

const canUsePush = Constants.executionEnvironment !== 'storeClient';
const logoSource = require('./assets/taemsa-logo.png');

const BRAND = {
  black: '#0A0A0A',
  blue: '#1B6FE8',
  indigo: '#4B45D4',
  coral: '#F07848',
  soft: '#8AB4F8',
};

const TYPE_COLORS = {
  error:         { bg: '#FEE2E2', border: '#EF4444', icon: '🔴' },
  problema:      { bg: '#FEF3C7', border: '#F59E0B', icon: '⚠️' },
  novedad:       { bg: '#D1FAE5', border: '#10B981', icon: '🟢' },
  info:          { bg: '#F3F4F6', border: '#6B7280', icon: 'ℹ️' },
};

function isNotificationForClient(notification, clientId) {
  const targets = notification?.targetClientIds;
  if (!Array.isArray(targets) || targets.length === 0) return true;
  return !!clientId && targets.includes(clientId);
}

export default function App() {
  const [notifications, setNotifications] = useState([]);
  const [farmaticUpdates, setFarmaticUpdates] = useState([]);
  const [infoArticles, setInfoArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [farmaticLoading, setFarmaticLoading] = useState(true);
  const [infoLoading, setInfoLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [deviceNameInput, setDeviceNameInput] = useState('');
  const [codeError, setCodeError] = useState('');
  const [savingCode, setSavingCode] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState('');
  const [pushReady, setPushReady] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [tab, setTab] = useState('avisos');
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [myReceipts, setMyReceipts] = useState({});
  const [supportEmail, setSupportEmail] = useState('');
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState('');
  const [ticketBody, setTicketBody] = useState('');
  const [ticketPhotos, setTicketPhotos] = useState([]);
  const [ticketSending, setTicketSending] = useState(false);
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketError, setTicketError] = useState('');
  const [myTickets, setMyTickets] = useState([]);
  const unsubscribePush = useRef(() => {});
  const deliveredIds = useRef(new Set());
  const tokenRef = useRef(null);
  const forceCreateRef = useRef(false);

  const resetLocalSession = async (message) => {
    await clearSession();
    setClientId('');
    setClientName('');
    setDeviceId('');
    setDeviceName('');
    setPushReady(false);
    setCodeError(message || 'Este dispositivo fue dado de baja. Vuelve a introducir el código.');
  };

  useEffect(() => {
    (async () => {
      try {
        await ensureAppCheck();
      } catch (err) {
        console.log('App Check no disponible:', err?.message ?? err);
      }

      const [session, loadedPrefs] = await Promise.all([
        ensureActiveSession(),
        loadPrefs(),
      ]);
      if (session) {
        setClientId(session.clientId);
        setClientName(session.clientName);
        setDeviceId(session.deviceId);
        setDeviceName(session.deviceName || '');
        const cached = await loadReceiptsCache(session.deviceId);
        if (Object.keys(cached).length) setMyReceipts(cached);
      }
      setPrefs(loadedPrefs);
    })().finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    if (!clientId || !clientName || !deviceId || !deviceName) return undefined;

    let cancelled = false;
    let unsubNotif = () => {};
    let unsubFarmatic = () => {};
    let unsubInfo = () => {};
    setDeviceStatus('Registrando dispositivo…');

    const afterRegister = async (token, expoGo) => {
      tokenRef.current = token;
      const allowCreate = forceCreateRef.current;
      forceCreateRef.current = false;
      const id = await registerDevice({
        token,
        expoGo,
        clientId,
        clientName,
        deviceId,
        deviceName,
        prefs,
        forceCreate: allowCreate,
      });
      if (!cancelled) {
        setDeviceId(id);
        setPushReady(Boolean(token));
        setDeviceStatus(`${clientName} · ${deviceName}`);
      }
    };

    const failRegister = async (err) => {
      const msg = err?.message ?? 'desconocido';
      if (!cancelled) {
        if (err?.code === 'device-revoked' || /dado de baja/i.test(msg)) {
          await resetLocalSession(msg);
          return;
        }
        setDeviceStatus(
          /permission|insufficient/i.test(msg)
            ? 'No se pudo sincronizar el dispositivo. Reabre la app o contacta con TAEMSA.'
            : 'Error al registrar: ' + msg,
        );
      }
    };

    (async () => {
      try {
        await ensureAppAuth();
      } catch (err) {
        if (!cancelled) {
          setDeviceStatus('Error de acceso: activa Anonymous Auth en Firebase');
          console.log(err);
        }
        return;
      }
      if (cancelled) return;

      // Registrar dispositivo ANTES de leer acuses (las reglas usan devices.uid).
      try {
        if (canUsePush) {
          try {
            const push = await import('./pushNotifications');
            if (cancelled) return;
            unsubscribePush.current = push.subscribeToPushListeners();
            const token = await push.registerForPushNotificationsAsync();
            if (cancelled) return;
            await afterRegister(token, false);
            if (!cancelled && !token) {
              setPushReady(false);
              setDeviceStatus(`${clientName} · ${deviceName}`);
            }
          } catch (pushErr) {
            console.log('Push no disponible:', pushErr?.message ?? pushErr);
            await afterRegister(null, false);
          }
        } else {
          await afterRegister(null, true);
        }
      } catch (err) {
        await failRegister(err);
        if (cancelled) return;
        // Seguir escuchando datos aunque falle el registro (p. ej. red).
      }
      if (cancelled) return;

      unsubNotif = onSnapshot(
        query(collection(db, 'notifications'), orderBy('createdAt', 'desc')),
        (snapshot) => {
          setNotifications(
            snapshot.docs
              .map((d) => ({ id: d.id, ...d.data() }))
              .filter((n) => isNotificationForClient(n, clientId)),
          );
          setLoading(false);
          setRefreshing(false);
        },
        (err) => {
          console.log('Error leyendo notificaciones:', err?.message ?? err);
          setLoading(false);
          setRefreshing(false);
        },
      );

      unsubFarmatic = onSnapshot(
        query(collection(db, 'farmaticUpdates'), orderBy('createdAt', 'desc')),
        (snapshot) => {
          setFarmaticUpdates(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
          setFarmaticLoading(false);
        },
        (err) => {
          console.log('Error leyendo Farmatic:', err?.message ?? err);
          setFarmaticLoading(false);
        },
      );

      unsubInfo = onSnapshot(
        query(collection(db, 'infoArticles'), orderBy('createdAt', 'desc')),
        (snapshot) => {
          setInfoArticles(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
          setInfoLoading(false);
        },
        (err) => {
          console.log('Error leyendo Información:', err?.message ?? err);
          setInfoLoading(false);
        },
      );
    })();

    return () => {
      cancelled = true;
      unsubscribePush.current?.();
      unsubNotif();
      unsubFarmatic();
      unsubInfo();
    };
  }, [clientId, clientName, deviceId, deviceName]);

  // Acuses por deviceId (estable), no por uid anónimo (puede rotar sin persistencia).
  // Cache local evita el flash "sin leer" al reabrir antes de que llegue Firestore.
  const notificationIdsKey = notifications.map((n) => n.id).join(',');
  useEffect(() => {
    if (!deviceId || !notificationIdsKey) return undefined;
    const ids = notificationIdsKey.split(',').filter(Boolean);
    const unsubs = ids.map((notificationId) =>
      onSnapshot(
        doc(db, 'notifications', notificationId, 'receipts', deviceId),
        (snap) => {
          setMyReceipts((map) => {
            if (!snap.exists()) return map;
            return { ...map, [notificationId]: snap.data() };
          });
        },
        (err) => console.log('Error leyendo receipt:', err?.message ?? err),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [deviceId, notificationIdsKey]);

  useEffect(() => {
    if (!deviceId || Object.keys(myReceipts).length === 0) return;
    saveReceiptsCache(deviceId, myReceipts);
  }, [deviceId, myReceipts]);

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
      }).catch((err) => {
        deliveredIds.current.delete(item.id);
        console.log('No se pudo marcar entregada:', err?.message ?? err);
      });
    });
  }, [notifications, deviceId, clientName, deviceName, prefs.alerts, myReceipts]);

  const handleRedeemCode = async () => {
    const code = codeInput.trim();
    if (!code || !deviceNameInput.trim() || savingCode) return;
    setSavingCode(true);
    setCodeError('');
    try {
      const { client, deviceId: id, deviceName: name } = await redeemClientCode(
        code,
        deviceNameInput,
      );
      forceCreateRef.current = true;
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

  const handleSaveDeviceName = async () => {
    if (!deviceNameInput.trim() || savingCode) return;
    setSavingCode(true);
    setCodeError('');
    try {
      const name = await saveDeviceNameOnly(deviceNameInput);
      forceCreateRef.current = true;
      setDeviceName(name);
      setDeviceNameInput('');
    } catch (err) {
      setCodeError(err?.message || 'No se pudo guardar el nombre');
    } finally {
      setSavingCode(false);
    }
  };

  const onRefresh = () => setRefreshing(true);

  const handlePrefChange = async (key, value) => {
    if (!deviceId || savingPrefs) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setSavingPrefs(true);
    try {
      await savePrefs(next);
      await updateDevicePrefs(deviceId, next, { clientId, clientName, deviceName });
      await registerDevice({
        token: tokenRef.current,
        expoGo: !canUsePush,
        clientId,
        clientName,
        deviceId,
        deviceName,
        prefs: next,
      });
    } catch (err) {
      if (err?.code === 'device-revoked') {
        await resetLocalSession(err.message);
      } else {
        console.log('No se pudieron guardar preferencias:', err?.message ?? err);
      }
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
      console.log('No se pudo marcar leída:', err?.message ?? err);
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
    setAppIconBadge(unreadCount);
  }, [unreadCount]);

  useEffect(() => {
    if (!clientId) {
      setSupportEmail('');
      return;
    }
    fetchClientSupportEmail(clientId)
      .then((email) => setSupportEmail(email))
      .catch(() => setSupportEmail(''));
  }, [clientId]);

  const loadT3Panel = async () => {
    if (!clientId || !deviceId) return;
    setTicketsLoading(true);
    setTicketsError('');
    try {
      const mine = await fetchMyT3Tickets({ clientId, deviceId });
      setMyTickets(mine?.tickets || []);
    } catch (err) {
      setTicketsError(err?.message || 'No se pudo cargar el historial');
    } finally {
      setTicketsLoading(false);
    }
  };

  useEffect(() => {
    if (tab !== 'incidencia' || !clientId || !deviceId) return undefined;
    loadT3Panel();
    return undefined;
  }, [tab, clientId, deviceId]);

  const pickTicketPhoto = async (fromCamera) => {
    if (ticketPhotos.length >= 3) {
      setTicketError('Máximo 3 fotos por incidencia.');
      return;
    }
    try {
      const ImagePicker = await import('expo-image-picker');
      const permission = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setTicketError(fromCamera
          ? 'Necesitamos permiso de cámara.'
          : 'Necesitamos permiso para acceder a la galería.');
        return;
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.55,
          allowsEditing: false,
          base64: true,
          exif: false,
        })
        : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.55,
          allowsEditing: false,
          base64: true,
          exif: false,
          selectionLimit: 1,
        });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      if (!asset.base64) {
        setTicketError('No se pudo leer la imagen. Prueba otra.');
        return;
      }
      const mime = asset.mimeType || 'image/jpeg';
      const ext = mime.includes('png') ? 'png' : 'jpg';
      const name = asset.fileName || `foto-${Date.now()}.${ext}`;
      setTicketPhotos((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          uri: asset.uri,
          name,
          mime,
          contentBase64: asset.base64,
        },
      ].slice(0, 3));
      setTicketError('');
    } catch (err) {
      setTicketError(err?.message || 'No se pudo añadir la foto');
    }
  };

  const removeTicketPhoto = (id) => {
    setTicketPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSendTicket = async () => {
    if (ticketSending || !clientId || !deviceId) return;
    setTicketError('');
    setTicketMessage('');
    if (!supportEmail) {
      setTicketError('Este cliente no tiene email configurado. Contacta con TAEMSA.');
      return;
    }
    if (!ticketBody.trim()) {
      setTicketError('Describe la incidencia.');
      return;
    }
    setTicketSending(true);
    try {
      const result = await createT3Ticket({
        clientId,
        deviceId,
        body: ticketBody.trim(),
        files: ticketPhotos.map((p) => ({
          name: p.name,
          mime: p.mime,
          contentBase64: p.contentBase64,
        })),
      });
      setTicketBody('');
      setTicketPhotos([]);
      setTicketMessage(result?.code
        ? `Incidencia creada: ${result.code}`
        : 'Incidencia enviada a T3. Si no ves el código aquí, compruébalo en Tencloud.');
      const mine = await fetchMyT3Tickets({ clientId, deviceId });
      setMyTickets(mine?.tickets || []);
    } catch (err) {
      setTicketError(err?.message || 'No se pudo crear la incidencia');
    } finally {
      setTicketSending(false);
    }
  };

  const renderItem = ({ item }) => {
    const type = TYPE_COLORS[item.type] || TYPE_COLORS.info;
    const date = item.createdAt?.toDate?.()?.toLocaleString('es-ES') || '';
    const read = !!myReceipts[item.id]?.readAt;

    return (
      <Pressable
        onPress={() => handleRead(item)}
        style={[
          styles.card,
          { backgroundColor: type.bg, borderLeftColor: type.border },
          !read && styles.cardUnread,
          read && styles.cardRead,
        ]}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardIcon}>{type.icon}</Text>
          <Text style={[styles.cardTitle, !read && styles.cardTitleUnread]}>{item.title}</Text>
          {!read ? (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>Sin leer</Text>
            </View>
          ) : (
            <Text style={styles.readLabel}>Leída</Text>
          )}
        </View>
        <Text style={[styles.cardBody, read && styles.cardBodyRead]}>{item.body}</Text>
        <View style={styles.cardFooter}>
          {date ? <Text style={styles.cardDate}>{date}</Text> : <View />}
          {!read ? (
            <Text style={styles.cardHintUnread}>Toca para marcar como leída</Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  const renderFarmatic = ({ item }) => {
    const date = item.createdAt?.toDate?.()?.toLocaleString('es-ES') || '';
    return (
      <View style={styles.farmaticCard}>
        {item.version ? <Text style={styles.farmaticVersion}>{item.version}</Text> : null}
        <Text style={styles.farmaticTitle}>{item.title}</Text>
        <Text style={styles.cardBody}>{item.body}</Text>
        {date ? <Text style={styles.cardDate}>{date}</Text> : null}
      </View>
    );
  };

  const renderInfo = ({ item }) => {
    const date = item.createdAt?.toDate?.()?.toLocaleString('es-ES') || '';
    const pdfs = Array.isArray(item.pdfs) && item.pdfs.length > 0
      ? item.pdfs.filter((p) => p?.url)
      : (item.pdfUrl ? [{ url: item.pdfUrl, name: item.pdfName || '' }] : []);
    return (
      <View style={styles.farmaticCard}>
        <Text style={styles.farmaticTitle}>{item.title}</Text>
        <Text style={styles.cardBody}>{item.body}</Text>
        {pdfs.map((pdf, idx) => (
          <Pressable
            key={pdf.path || `${pdf.url}-${idx}`}
            style={styles.pdfBtn}
            onPress={() => Linking.openURL(pdf.url)}
          >
            <Text style={styles.pdfLink}>
              {pdfs.length > 1
                ? `Abrir PDF ${idx + 1}${pdf.name ? `: ${pdf.name}` : ''}`
                : `Abrir PDF${pdf.name ? `: ${pdf.name}` : ''}`}
            </Text>
          </Pressable>
        ))}
        {date ? <Text style={styles.cardDate}>{date}</Text> : null}
      </View>
    );
  };

  if (checkingSession) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={BRAND.black} />
        <ActivityIndicator size="large" color={BRAND.blue} style={{ marginTop: 80 }} />
      </View>
    );
  }

  if (!clientId || !clientName || !deviceId) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <StatusBar barStyle="light-content" backgroundColor={BRAND.black} />
        <View style={styles.header}>
          <Image source={logoSource} style={styles.headerLogo} resizeMode="contain" />
          <Text style={styles.headerSubtitle}>Acceso de cliente</Text>
        </View>
        <View style={styles.registerBox}>
          <Text style={styles.registerTitle}>Código de cliente</Text>
          <Text style={styles.registerHint}>
            Introduce el código de TAEMSA y un nombre para reconocer este dispositivo.
          </Text>
          <TextInput
            style={styles.registerInput}
            placeholder="Código: TAEM-XXXXXX"
            placeholderTextColor="#94A3B8"
            value={codeInput}
            onChangeText={(v) => setCodeInput(v.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            returnKeyType="next"
          />
          <TextInput
            style={styles.registerInput}
            placeholder="Nombre (ej. PC recepción)"
            placeholderTextColor="#94A3B8"
            value={deviceNameInput}
            onChangeText={setDeviceNameInput}
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleRedeemCode}
          />
          {codeError ? <Text style={styles.codeError}>{codeError}</Text> : null}
          <Pressable
            style={[
              styles.registerBtn,
              (!codeInput.trim() || !deviceNameInput.trim()) && styles.registerBtnDisabled,
            ]}
            onPress={handleRedeemCode}
            disabled={!codeInput.trim() || !deviceNameInput.trim() || savingCode}
          >
            <Text style={styles.registerBtnText}>
              {savingCode ? 'Validando…' : 'Continuar'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  if (!deviceName) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <StatusBar barStyle="light-content" backgroundColor={BRAND.black} />
        <View style={styles.header}>
          <Image source={logoSource} style={styles.headerLogo} resizeMode="contain" />
          <Text style={styles.headerSubtitle}>{clientName}</Text>
        </View>
        <View style={styles.registerBox}>
          <Text style={styles.registerTitle}>Nombre de este dispositivo</Text>
          <Text style={styles.registerHint}>
            Así en el panel de TAEMSA sabremos de cuál se trata (ej. iPhone Ana, PC mostrador).
          </Text>
          <TextInput
            style={styles.registerInput}
            placeholder="Ej: PC recepción"
            placeholderTextColor="#94A3B8"
            value={deviceNameInput}
            onChangeText={setDeviceNameInput}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleSaveDeviceName}
          />
          {codeError ? <Text style={styles.codeError}>{codeError}</Text> : null}
          <Pressable
            style={[styles.registerBtn, !deviceNameInput.trim() && styles.registerBtnDisabled]}
            onPress={handleSaveDeviceName}
            disabled={!deviceNameInput.trim() || savingCode}
          >
            <Text style={styles.registerBtnText}>
              {savingCode ? 'Guardando…' : 'Continuar'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND.black} />

      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.headerCopy}>
            <Image source={logoSource} style={styles.headerLogo} resizeMode="contain" />
            <Text style={styles.headerSubtitle}>
              {tab === 'prefs' ? 'Preferencias' : 'Soporte Farmatic'}
            </Text>
          </View>
          <Pressable
            style={styles.iconBtn}
            onPress={() => setTab(tab === 'prefs' ? 'avisos' : 'prefs')}
            accessibilityLabel={tab === 'prefs' ? 'Volver' : 'Ajustes'}
          >
            <Text style={styles.iconBtnText}>{tab === 'prefs' ? '←' : '⚙'}</Text>
          </Pressable>
        </View>
        {tab !== 'prefs' ? (
          <>
            <View style={styles.statusRow}>
              <Text style={styles.headerStatus}>{deviceStatus}</Text>
              <View
                style={[styles.notifBadge, pushReady ? styles.notifBadgeOn : styles.notifBadgeOff]}
                accessibilityLabel={pushReady ? 'Notificaciones activas' : 'Notificaciones desactivadas'}
              >
                <Text style={styles.notifBadgeText}>{pushReady ? '🔔' : '🔕'}</Text>
              </View>
            </View>
            {unreadCount > 0 ? (
              <View style={styles.headerUnreadRow}>
                <View style={styles.headerUnreadPill}>
                  <Text style={styles.headerUnreadText}>
                    {unreadCount === 1 ? '1 aviso sin leer' : `${unreadCount} avisos sin leer`}
                  </Text>
                </View>
              </View>
            ) : null}
          </>
        ) : null}
      </View>

      {tab !== 'prefs' ? (
        <View style={styles.tabs}>
          <Pressable
            style={[styles.tab, tab === 'avisos' && styles.tabActive]}
            onPress={() => setTab('avisos')}
          >
            <Text style={[styles.tabText, tab === 'avisos' && styles.tabTextActive]}>Avisos</Text>
          </Pressable>
          <Pressable
            style={[styles.tab, tab === 'farmatic' && styles.tabActive]}
            onPress={() => setTab('farmatic')}
          >
            <Text style={[styles.tabText, tab === 'farmatic' && styles.tabTextActive]}>Farmatic</Text>
          </Pressable>
          <Pressable
            style={[styles.tab, tab === 'info' && styles.tabActive]}
            onPress={() => setTab('info')}
          >
            <Text style={[styles.tabText, tab === 'info' && styles.tabTextActive]}>Información</Text>
          </Pressable>
          <Pressable
            style={[styles.tab, tab === 'incidencia' && styles.tabActive]}
            onPress={() => setTab('incidencia')}
          >
            <Text style={[styles.tabText, tab === 'incidencia' && styles.tabTextActive]}>Incidencia</Text>
          </Pressable>
        </View>
      ) : null}

      {tab === 'avisos' && (
        !prefs.alerts ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Avisos desactivados</Text>
            <Text style={styles.emptySubText}>Actívalos en Preferencias si quieres recibirlos</Text>
          </View>
        ) : loading ? (
          <ActivityIndicator size="large" color={BRAND.blue} style={{ marginTop: 40 }} />
        ) : notifications.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🔔</Text>
            <Text style={styles.emptyText}>No hay avisos</Text>
            <Text style={styles.emptySubText}>Te avisaremos cuando haya novedades</Text>
          </View>
        ) : (
          <FlatList
            data={notifications}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND.blue]} />
            }
          />
        )
      )}

      {tab === 'farmatic' && (
        !prefs.farmatic ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Actualizaciones Farmatic desactivadas</Text>
            <Text style={styles.emptySubText}>Actívalas en Preferencias si quieres verlas</Text>
          </View>
        ) : farmaticLoading ? (
          <ActivityIndicator size="large" color={BRAND.blue} style={{ marginTop: 40 }} />
        ) : farmaticUpdates.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyText}>Sin actualizaciones</Text>
            <Text style={styles.emptySubText}>Aquí verás el historial de Farmatic</Text>
          </View>
        ) : (
          <FlatList
            data={farmaticUpdates}
            keyExtractor={(item) => item.id}
            renderItem={renderFarmatic}
            contentContainerStyle={styles.list}
          />
        )
      )}

      {tab === 'info' && (
        !prefs.info ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Información desactivada</Text>
            <Text style={styles.emptySubText}>Actívala en Preferencias si quieres verla</Text>
          </View>
        ) : infoLoading ? (
          <ActivityIndicator size="large" color={BRAND.blue} style={{ marginTop: 40 }} />
        ) : infoArticles.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📄</Text>
            <Text style={styles.emptyText}>Sin información</Text>
            <Text style={styles.emptySubText}>Aquí verás normativas y guías</Text>
          </View>
        ) : (
          <FlatList
            data={infoArticles}
            keyExtractor={(item) => item.id}
            renderItem={renderInfo}
            contentContainerStyle={styles.list}
          />
        )
      )}

      {tab === 'incidencia' && (
        <ScrollView contentContainerStyle={styles.ticketBox} keyboardShouldPersistTaps="handled">
          <Text style={styles.prefsTitle}>Nueva incidencia</Text>
          <Text style={styles.prefsHint}>
            Se enviará a soporte TAEMSA (Tencloud T3)
            {supportEmail ? ` como ${supportEmail}` : ''}.
          </Text>

          {!supportEmail ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Email no configurado</Text>
              <Text style={styles.emptySubText}>Contacta con TAEMSA para activar incidencias</Text>
            </View>
          ) : ticketsLoading ? (
            <ActivityIndicator size="large" color={BRAND.blue} style={{ marginTop: 24 }} />
          ) : (
            <>
              {ticketsError ? (
                <Text style={styles.ticketError}>{ticketsError}</Text>
              ) : null}

              <Text style={styles.prefsHint}>Sección ONLINE · Tipología FARMATIC</Text>

              <Text style={styles.ticketLabel}>Descripción</Text>
              <TextInput
                style={styles.ticketInput}
                multiline
                numberOfLines={5}
                placeholder="Describe el problema o la solicitud…"
                placeholderTextColor="#94A3B8"
                value={ticketBody}
                onChangeText={setTicketBody}
                textAlignVertical="top"
              />

              <Text style={styles.ticketLabel}>Fotos (opcional, máx. 3)</Text>
              <View style={styles.photoActions}>
                <Pressable style={styles.photoBtn} onPress={() => pickTicketPhoto(true)}>
                  <Text style={styles.photoBtnText}>Hacer foto</Text>
                </Pressable>
                <Pressable style={styles.photoBtn} onPress={() => pickTicketPhoto(false)}>
                  <Text style={styles.photoBtnText}>Galería</Text>
                </Pressable>
              </View>
              {ticketPhotos.length > 0 ? (
                <View style={styles.photoPreviewRow}>
                  {ticketPhotos.map((photo) => (
                    <View key={photo.id} style={styles.photoPreview}>
                      <Image source={{ uri: photo.uri }} style={styles.photoThumb} />
                      <Pressable
                        style={styles.photoRemove}
                        onPress={() => removeTicketPhoto(photo.id)}
                      >
                        <Text style={styles.photoRemoveText}>✕</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}

              {ticketError ? <Text style={styles.ticketError}>{ticketError}</Text> : null}
              {ticketMessage ? <Text style={styles.ticketOk}>{ticketMessage}</Text> : null}

              <Pressable
                style={[styles.ticketBtn, ticketSending && styles.ticketBtnDisabled]}
                onPress={handleSendTicket}
                disabled={ticketSending}
              >
                <Text style={styles.ticketBtnText}>
                  {ticketSending ? 'Enviando…' : 'Enviar incidencia'}
                </Text>
              </Pressable>

              {myTickets.length > 0 ? (
                <View style={styles.ticketHistory}>
                  <Text style={styles.ticketLabel}>Últimas enviadas</Text>
                  {myTickets.slice(0, 8).map((t) => (
                    <View key={t.id} style={styles.ticketHistoryRow}>
                      <Text style={styles.ticketHistoryCode}>{t.code}</Text>
                      <Text style={styles.ticketHistoryBody} numberOfLines={2}>{t.body}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      )}

      {tab === 'prefs' && (
        <View style={styles.prefsBox}>
          <Text style={styles.prefsTitle}>Qué quieres recibir</Text>
          <Text style={styles.prefsHint}>
            Por defecto todo está activo. Puedes desactivar lo que no necesites.
          </Text>

          <View style={styles.prefRow}>
            <View style={styles.prefCopy}>
              <Text style={styles.prefLabel}>Avisos de soporte</Text>
              <Text style={styles.prefDesc}>Incidencias, problemas y avisos puntuales</Text>
            </View>
            <Switch
              value={prefs.alerts}
              onValueChange={(v) => handlePrefChange('alerts', v)}
              disabled={savingPrefs}
            />
          </View>

          <View style={styles.prefRow}>
            <View style={styles.prefCopy}>
              <Text style={styles.prefLabel}>Actualizaciones Farmatic</Text>
              <Text style={styles.prefDesc}>Historial y avisos de nuevas versiones</Text>
            </View>
            <Switch
              value={prefs.farmatic}
              onValueChange={(v) => handlePrefChange('farmatic', v)}
              disabled={savingPrefs}
            />
          </View>

          <View style={styles.prefRow}>
            <View style={styles.prefCopy}>
              <Text style={styles.prefLabel}>Información</Text>
              <Text style={styles.prefDesc}>Normativas, comunicados y guías</Text>
            </View>
            <Switch
              value={prefs.info}
              onValueChange={(v) => handlePrefChange('info', v)}
              disabled={savingPrefs}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    backgroundColor: BRAND.black,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 16 : 60,
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
  },
  headerLogo: {
    width: 180,
    height: 48,
    marginBottom: 4,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  headerSubtitle: {
    color: BRAND.soft,
    fontSize: 14,
    marginTop: 2,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(147, 197, 253, 0.35)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: {
    color: '#E0F2FE',
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 22,
  },
  headerStatus: {
    color: '#BFDBFE',
    fontSize: 12,
    flexShrink: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  notifBadge: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBadgeOn: {
    backgroundColor: 'rgba(34, 197, 94, 0.18)',
  },
  notifBadgeOff: {
    backgroundColor: 'rgba(239, 68, 68, 0.16)',
  },
  notifBadgeText: {
    fontSize: 12,
    lineHeight: 14,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: BRAND.blue,
  },
  tabText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  tabTextActive: {
    color: BRAND.blue,
  },
  ticketBox: {
    padding: 20,
    paddingBottom: 40,
  },
  ticketLabel: {
    marginTop: 14,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#E2E8F0',
  },
  chipOn: {
    backgroundColor: BRAND.blue,
  },
  chipText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
  },
  chipTextOn: {
    color: '#FFFFFF',
  },
  ticketInput: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#FFFFFF',
    fontSize: 15,
    color: '#0F172A',
  },
  photoActions: {
    flexDirection: 'row',
    gap: 10,
  },
  photoBtn: {
    flex: 1,
    backgroundColor: '#E2E8F0',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  photoBtnText: {
    fontWeight: '700',
    color: '#334155',
    fontSize: 14,
  },
  photoPreviewRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  photoPreview: {
    width: 84,
    height: 84,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#E2E8F0',
  },
  photoThumb: {
    width: '100%',
    height: '100%',
  },
  photoRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(15,23,42,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRemoveText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  ticketBtn: {
    marginTop: 16,
    backgroundColor: BRAND.blue,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ticketBtnDisabled: {
    opacity: 0.6,
  },
  ticketBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  ticketError: {
    marginTop: 10,
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: '600',
  },
  ticketOk: {
    marginTop: 10,
    color: '#047857',
    fontSize: 13,
    fontWeight: '600',
  },
  ticketHistory: {
    marginTop: 24,
  },
  ticketHistoryRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  ticketHistoryCode: {
    fontWeight: '700',
    color: BRAND.blue,
    marginBottom: 4,
  },
  ticketHistoryBody: {
    color: '#64748B',
    fontSize: 13,
  },
  registerBox: {
    padding: 24,
  },
  registerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 8,
  },
  registerHint: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 20,
    lineHeight: 20,
  },
  registerInput: {
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1E293B',
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
  },
  registerBtn: {
    backgroundColor: BRAND.blue,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  registerBtnDisabled: {
    opacity: 0.5,
  },
  registerBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  codeError: {
    color: '#B91C1C',
    fontSize: 13,
    marginBottom: 12,
  },
  list: {
    padding: 16,
    gap: 12,
  },
  headerUnreadRow: {
    marginTop: 12,
  },
  headerUnreadPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#FBBF24',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  headerUnreadText: {
    color: '#78350F',
    fontSize: 13,
    fontWeight: '700',
  },
  card: {
    borderRadius: 12,
    borderLeftWidth: 4,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  cardUnread: {
    borderLeftWidth: 6,
    shadowOpacity: 0.14,
    elevation: 3,
  },
  cardRead: {
    opacity: 0.72,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  cardIcon: {
    fontSize: 18,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
    flex: 1,
  },
  cardTitleUnread: {
    fontWeight: '800',
  },
  cardBody: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
  },
  cardBodyRead: {
    color: '#64748B',
  },
  cardFooter: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardDate: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 8,
    textAlign: 'right',
  },
  cardHintUnread: {
    fontSize: 11,
    color: BRAND.blue,
    fontWeight: '600',
  },
  unreadBadge: {
    backgroundColor: BRAND.coral,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  unreadBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  readLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  farmaticCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: BRAND.blue,
  },
  farmaticVersion: {
    alignSelf: 'flex-start',
    backgroundColor: '#DBEAFE',
    color: BRAND.indigo,
    overflow: 'hidden',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginBottom: 8,
  },
  farmaticTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 6,
  },
  pdfLink: {
    fontSize: 13,
    fontWeight: '700',
    color: BRAND.blue,
  },
  pdfBtn: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
  },
  prefsBox: {
    padding: 20,
  },
  prefsTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 6,
  },
  prefsHint: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 20,
    lineHeight: 20,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  prefCopy: {
    flex: 1,
  },
  prefLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  prefDesc: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 60,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#334155',
    textAlign: 'center',
  },
  emptySubText: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 4,
    textAlign: 'center',
  },
});
