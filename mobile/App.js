import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet, Text, View, FlatList, TextInput, Pressable, Switch,
  Platform, StatusBar, ActivityIndicator, RefreshControl, KeyboardAvoidingView,
} from 'react-native';
import Constants from 'expo-constants';
import { db, ensureAppAuth } from './firebase';
import {
  collection, onSnapshot, orderBy, query,
} from 'firebase/firestore';
import { registerDevice, updateDevicePrefs } from './registerDevice';
import { loadClientName, saveClientName } from './clientName';
import { markNotificationDelivered, markNotificationRead } from './receipts';
import { DEFAULT_PREFS } from './prefs';
import { loadPrefs, savePrefs } from './prefsStorage';

const canUsePush = Constants.executionEnvironment !== 'storeClient';

const TYPE_COLORS = {
  error:         { bg: '#FEE2E2', border: '#EF4444', icon: '🔴' },
  problema:      { bg: '#FEF3C7', border: '#F59E0B', icon: '⚠️' },
  novedad:       { bg: '#D1FAE5', border: '#10B981', icon: '🟢' },
  info:          { bg: '#F3F4F6', border: '#6B7280', icon: 'ℹ️' },
};

export default function App() {
  const [notifications, setNotifications] = useState([]);
  const [farmaticUpdates, setFarmaticUpdates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [farmaticLoading, setFarmaticLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checkingName, setCheckingName] = useState(true);
  const [clientName, setClientName] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [tab, setTab] = useState('avisos');
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const unsubscribePush = useRef(() => {});
  const deliveredIds = useRef(new Set());
  const tokenRef = useRef(null);

  useEffect(() => {
    Promise.all([loadClientName(), loadPrefs()])
      .then(([name, loadedPrefs]) => {
        if (name) setClientName(name);
        setPrefs(loadedPrefs);
      })
      .finally(() => setCheckingName(false));
  }, []);

  useEffect(() => {
    if (!clientName) return undefined;

    let cancelled = false;
    let unsubNotif = () => {};
    let unsubFarmatic = () => {};
    setDeviceStatus('Registrando dispositivo…');

    const afterRegister = async (token, expoGo) => {
      tokenRef.current = token;
      const id = await registerDevice({ token, expoGo, clientName, prefs });
      if (!cancelled) {
        setDeviceId(id);
        setDeviceStatus(token ? `${clientName} · Push activo` : `${clientName} · Sin token push`);
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
          await afterRegister(token, false);
          if (!cancelled && !token) {
            setDeviceStatus(`${clientName} · Sin token push`);
          }
        }).catch((err) => {
          console.log('Push no disponible:', err?.message ?? err);
          afterRegister(null, false).catch(() => {
            if (!cancelled) setDeviceStatus('No se pudo registrar');
          });
        });
      } else {
        afterRegister(null, true).catch((err) => {
          if (!cancelled) setDeviceStatus('Error al registrar: ' + (err?.message ?? 'desconocido'));
        });
      }

      unsubNotif = onSnapshot(
        query(collection(db, 'notifications'), orderBy('createdAt', 'desc')),
        (snapshot) => {
          setNotifications(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
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
    })();

    return () => {
      cancelled = true;
      unsubscribePush.current?.();
      unsubNotif();
      unsubFarmatic();
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
      }).catch((err) => {
        deliveredIds.current.delete(item.id);
        console.log('No se pudo marcar entregada:', err?.message ?? err);
      });
    });
  }, [notifications, deviceId, clientName, prefs.alerts]);

  const handleSaveClient = async () => {
    const name = nameInput.trim();
    if (!name || savingName) return;
    setSavingName(true);
    await saveClientName(name);
    setClientName(name);
    setSavingName(false);
  };

  const onRefresh = () => setRefreshing(true);

  const handlePrefChange = async (key, value) => {
    if (!deviceId || savingPrefs) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setSavingPrefs(true);
    try {
      await savePrefs(next);
      await updateDevicePrefs(deviceId, next);
      await registerDevice({
        token: tokenRef.current,
        expoGo: !canUsePush,
        clientName,
        prefs: next,
      });
    } catch (err) {
      console.log('No se pudieron guardar preferencias:', err?.message ?? err);
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
    }).catch((err) => {
      console.log('No se pudo marcar leída:', err?.message ?? err);
    });
  };

  const unreadCount = deviceId && prefs.alerts
    ? notifications.filter((n) => !n.receipts?.[deviceId]?.readAt).length
    : 0;

  const renderItem = ({ item }) => {
    const type = TYPE_COLORS[item.type] || TYPE_COLORS.info;
    const date = item.createdAt?.toDate?.()?.toLocaleString('es-ES') || '';
    const read = !!item.receipts?.[deviceId]?.readAt;

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

  if (checkingName) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#1E3A5F" />
        <ActivityIndicator size="large" color="#1E3A5F" style={{ marginTop: 80 }} />
      </View>
    );
  }

  if (!clientName) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <StatusBar barStyle="light-content" backgroundColor="#1E3A5F" />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>TAEMSA</Text>
          <Text style={styles.headerSubtitle}>Registro de cliente</Text>
        </View>
        <View style={styles.registerBox}>
          <Text style={styles.registerTitle}>Nombre del cliente</Text>
          <Text style={styles.registerHint}>
            Así el panel sabrá de quién es este dispositivo.
          </Text>
          <TextInput
            style={styles.registerInput}
            placeholder="Ej: Taller Norte"
            placeholderTextColor="#94A3B8"
            value={nameInput}
            onChangeText={setNameInput}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleSaveClient}
          />
          <Pressable
            style={[styles.registerBtn, !nameInput.trim() && styles.registerBtnDisabled]}
            onPress={handleSaveClient}
            disabled={!nameInput.trim() || savingName}
          >
            <Text style={styles.registerBtnText}>
              {savingName ? 'Guardando…' : 'Continuar'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1E3A5F" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>TAEMSA</Text>
        <Text style={styles.headerSubtitle}>Soporte Farmatic</Text>
        <Text style={styles.headerStatus}>{deviceStatus}</Text>
        {unreadCount > 0 ? (
          <View style={styles.headerUnreadRow}>
            <View style={styles.headerUnreadPill}>
              <Text style={styles.headerUnreadText}>
                {unreadCount === 1 ? '1 aviso sin leer' : `${unreadCount} avisos sin leer`}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

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
          style={[styles.tab, tab === 'prefs' && styles.tabActive]}
          onPress={() => setTab('prefs')}
        >
          <Text style={[styles.tabText, tab === 'prefs' && styles.tabTextActive]}>Preferencias</Text>
        </Pressable>
      </View>

      {tab === 'avisos' && (
        !prefs.alerts ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Avisos desactivados</Text>
            <Text style={styles.emptySubText}>Actívalos en Preferencias si quieres recibirlos</Text>
          </View>
        ) : loading ? (
          <ActivityIndicator size="large" color="#1E3A5F" style={{ marginTop: 40 }} />
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
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#1E3A5F']} />
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
          <ActivityIndicator size="large" color="#1E3A5F" style={{ marginTop: 40 }} />
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

      {tab === 'prefs' && (
        <View style={styles.prefsBox}>
          <Text style={styles.prefsTitle}>Qué quieres recibir</Text>
          <Text style={styles.prefsHint}>
            Por defecto ambos están activos. Puedes dejar solo uno o ninguno.
          </Text>

          <View style={styles.prefRow}>
            <View style={styles.prefCopy}>
              <Text style={styles.prefLabel}>Avisos de soporte</Text>
              <Text style={styles.prefDesc}>Incidencias, novedades e información</Text>
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
    backgroundColor: '#1E3A5F',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 16 : 60,
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  headerSubtitle: {
    color: '#93C5FD',
    fontSize: 14,
    marginTop: 2,
  },
  headerStatus: {
    color: '#BFDBFE',
    fontSize: 12,
    marginTop: 8,
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
    borderBottomColor: '#1E3A5F',
  },
  tabText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#1E3A5F',
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
    backgroundColor: '#1E3A5F',
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
    color: '#1E3A5F',
    fontWeight: '600',
  },
  unreadBadge: {
    backgroundColor: '#1E3A5F',
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
    borderLeftColor: '#1E3A5F',
  },
  farmaticVersion: {
    alignSelf: 'flex-start',
    backgroundColor: '#DBEAFE',
    color: '#1E3A5F',
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
