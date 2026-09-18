import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet, Text, View, FlatList, TextInput, Pressable, Switch, Image,
  Platform, StatusBar, ActivityIndicator, RefreshControl, KeyboardAvoidingView, Linking,
} from 'react-native';
import Constants from 'expo-constants';
import { db, ensureAppAuth, auth } from './firebase';
import {
  collection, collectionGroup, onSnapshot, orderBy, query, where,
} from 'firebase/firestore';
import {
  ensureActiveSession,
  redeemClientCode,
  saveDeviceNameOnly,
  registerDevice,
  updateDevicePrefs,
} from './registerDevice';
import { markNotificationDelivered, markNotificationRead } from './receipts';
import { DEFAULT_PREFS } from './prefs';
import { loadPrefs, savePrefs } from './prefsStorage';
import { setAppIconBadge } from './badge';
import { clearSession } from './clientSession';

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
    Promise.all([ensureActiveSession(), loadPrefs()])
      .then(([session, loadedPrefs]) => {
        if (session) {
          setClientId(session.clientId);
          setClientName(session.clientName);
          setDeviceId(session.deviceId);
          setDeviceName(session.deviceName || '');
        }
        setPrefs(loadedPrefs);
      })
      .finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    if (!clientId || !clientName || !deviceId || !deviceName) return undefined;

    let cancelled = false;
    let unsubNotif = () => {};
    let unsubFarmatic = () => {};
    let unsubInfo = () => {};
    let unsubReceipts = () => {};
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

      if (canUsePush) {
        import('./pushNotifications').then(async (push) => {
          if (cancelled) return;
          unsubscribePush.current = push.subscribeToPushListeners();
          const token = await push.registerForPushNotificationsAsync();
          if (cancelled) return;
          try {
            await afterRegister(token, false);
            if (!cancelled && !token) {
              setPushReady(false);
              setDeviceStatus(`${clientName} · ${deviceName}`);
            }
          } catch (err) {
            await failRegister(err);
          }
        }).catch((err) => {
          console.log('Push no disponible:', err?.message ?? err);
          afterRegister(null, false).catch(failRegister);
        });
      } else {
        afterRegister(null, true).catch(failRegister);
      }

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

      if (auth.currentUser?.uid) {
        unsubReceipts = onSnapshot(
          query(collectionGroup(db, 'receipts'), where('uid', '==', auth.currentUser.uid)),
          (snapshot) => {
            const map = {};
            snapshot.docs.forEach((d) => {
              const notificationId = d.ref.parent.parent?.id;
              if (notificationId) map[notificationId] = d.data();
            });
            setMyReceipts(map);
          },
          (err) => console.log('Error leyendo receipts:', err?.message ?? err),
        );
      }
    })();

    return () => {
      cancelled = true;
      unsubscribePush.current?.();
      unsubNotif();
      unsubFarmatic();
      unsubInfo();
      unsubReceipts();
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
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  tabTextActive: {
    color: BRAND.blue,
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
