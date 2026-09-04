import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet, Text, View, FlatList, TextInput, Pressable,
  Platform, StatusBar, ActivityIndicator, RefreshControl, KeyboardAvoidingView,
} from 'react-native';
import Constants from 'expo-constants';
import { db } from './firebase';
import {
  collection, onSnapshot, orderBy, query,
} from 'firebase/firestore';
import { registerDevice } from './registerDevice';
import { loadClientName, saveClientName } from './clientName';
import { markNotificationDelivered, markNotificationRead } from './receipts';

const canUsePush = Constants.executionEnvironment !== 'storeClient';

// Colores por tipo de notificación
const TYPE_COLORS = {
  error:        { bg: '#FEE2E2', border: '#EF4444', icon: '🔴' },
  problema:     { bg: '#FEF3C7', border: '#F59E0B', icon: '⚠️' },
  actualizacion:{ bg: '#DBEAFE', border: '#3B82F6', icon: '🔵' },
  novedad:      { bg: '#D1FAE5', border: '#10B981', icon: '🟢' },
  info:         { bg: '#F3F4F6', border: '#6B7280', icon: 'ℹ️' },
};

export default function App() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checkingName, setCheckingName] = useState(true);
  const [clientName, setClientName] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const unsubscribePush = useRef(() => {});
  const deliveredIds = useRef(new Set());

  useEffect(() => {
    loadClientName()
      .then((name) => {
        if (name) setClientName(name);
      })
      .finally(() => setCheckingName(false));
  }, []);

  useEffect(() => {
    if (!clientName) return undefined;

    let cancelled = false;
    setDeviceStatus('Registrando dispositivo…');

    const afterRegister = async (token, expoGo) => {
      const id = await registerDevice({ token, expoGo, clientName });
      if (!cancelled) {
        setDeviceId(id);
        setDeviceStatus(token ? `${clientName} · Push activo` : `${clientName} · Sin token push`);
      }
    };

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

    const q = query(collection(db, 'notifications'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setNotifications(data);
        setLoading(false);
        setRefreshing(false);
      },
      (err) => {
        console.log('Error leyendo notificaciones:', err?.message ?? err);
        setLoading(false);
        setRefreshing(false);
      },
    );

    return () => {
      cancelled = true;
      unsubscribePush.current?.();
      unsubscribe();
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
      }).catch((err) => {
        deliveredIds.current.delete(item.id);
        console.log('No se pudo marcar entregada:', err?.message ?? err);
      });
    });
  }, [notifications, deviceId, clientName]);

  const handleSaveClient = async () => {
    const name = nameInput.trim();
    if (!name || savingName) return;
    setSavingName(true);
    await saveClientName(name);
    setClientName(name);
    setSavingName(false);
  };

  const onRefresh = () => setRefreshing(true);

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

  const unreadCount = deviceId
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

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>TAEMSA</Text>
        <Text style={styles.headerSubtitle}>Centro de Notificaciones</Text>
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

      {/* Lista de notificaciones */}
      {loading ? (
        <ActivityIndicator size="large" color="#1E3A5F" style={{ marginTop: 40 }} />
      ) : notifications.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🔔</Text>
          <Text style={styles.emptyText}>No hay notificaciones</Text>
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
    paddingBottom: 20,
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
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#334155',
  },
  emptySubText: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 4,
  },
});
