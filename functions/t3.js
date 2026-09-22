const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const t3BaseUrl = defineString('T3_BASE_URL', { default: 'https://taemsa.tencloud.es' });
const t3User = defineSecret('T3_USER');
const t3Password = defineSecret('T3_PASSWORD');
const t3Organization = defineSecret('T3_ORGANIZATION');
const t3Company = defineSecret('T3_COMPANY');

const T3_SECRETS = [t3User, t3Password, t3Organization, t3Company];
/** Código ISO2 del idioma en T3 (tabla Idiomas.CodigoISO2 = CA; la UI muestra CATALÀ). */
const T3_LANGUAGE = 'CA';
/** Fijo: Sección ONLINE → RequestType; Tipología FARMATIC → Type. */
const T3_REQUEST_TYPE = 'ONLINE';
const T3_TYPE = 'FARMATIC';

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  return request.auth.uid;
}

function parseOptionsHtml(html) {
  if (typeof html !== 'string' || !html) return [];
  const values = [];
  const re = /<option[^>]*>([^<]*)<\/option>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const label = String(match[1] || '').trim();
    if (label) values.push(label);
  }
  return values;
}

class CookieJar {
  constructor() {
    this.map = new Map();
  }

  store(response) {
    const raw = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];
    const single = response.headers.get('set-cookie');
    const list = raw.length ? raw : (single ? [single] : []);
    list.forEach((line) => {
      const part = String(line).split(';')[0];
      const eq = part.indexOf('=');
      if (eq <= 0) return;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (name) this.map.set(name, value);
    });
  }

  header() {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

function t3Config() {
  const base = String(t3BaseUrl.value() || 'https://taemsa.tencloud.es').replace(/\/+$/, '');
  const organization = Number(String(t3Organization.value() || '').trim());
  const company = Number(String(t3Company.value() || '').trim());
  const user = String(t3User.value() || '').trim();
  // Importante: PowerShell al guardar secrets puede meter \r\n al final.
  const password = String(t3Password.value() || '').trim();
  if (!user || user === 'PENDING_SET_ME' || !password || password === 'PENDING_SET_ME'
      || !Number.isFinite(organization) || organization <= 0
      || !Number.isFinite(company) || company <= 0) {
    throw new HttpsError(
      'failed-precondition',
      'Falta configuración T3 (usuario, contraseña, organización o empresa).',
    );
  }
  return { base, organization, company, user, password };
}

function formEncode(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v == null ? '' : String(v))}`)
    .join('&');
}

async function t3Post(base, path, payload, jar, { asForm = false } = {}) {
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': asForm
        ? 'application/x-www-form-urlencoded; charset=UTF-8'
        : 'application/json; charset=utf-8',
      Accept: 'application/json, text/plain, */*',
      ...(jar.header() ? { Cookie: jar.header() } : {}),
    },
    body: asForm ? formEncode(payload) : JSON.stringify(payload),
  });
  jar.store(res);
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    // plain string / html options
  }
  if (!res.ok) {
    throw new HttpsError('internal', `Error T3 (${res.status}) en ${path}`);
  }
  return data;
}

async function t3Login(cfg, jar) {
  // Igual que la web T3 (index.min.js): form-urlencoded, sin organization.
  // Respuestas: 1 y 2 → /app (OK), 3 → /public, 4 → 2FA, 0 → error.
  const result = await t3Post(cfg.base, '/login/login', {
    user: cfg.user,
    password: cfg.password,
    remember: 0,
    twoFA: '',
  }, jar, { asForm: true });

  const ok = result === 1 || result === '1' || result === 2 || result === '2';
  if (!ok) {
    console.error('t3Login rejected', {
      user: cfg.user,
      resultType: typeof result,
      result: typeof result === 'string' ? result.slice(0, 200) : result,
    });
    if (result === 4 || result === '4') {
      throw new HttpsError(
        'failed-precondition',
        'El usuario T3 tiene 2FA activo. Desactívalo para la cuenta de API o usa un usuario sin doble factor.',
      );
    }
    throw new HttpsError(
      'internal',
      'No se pudo iniciar sesión en T3. Revisa usuario o contraseña.',
    );
  }
}

async function assertContactEmail(cfg, email) {
  const result = await t3Post(cfg.base, '/PublicAPI/CheckContactEmail', {
    organization: cfg.organization,
    email,
  }, new CookieJar());
  const exists = result === true || result === 'true' || result === 1 || result === '1';
  if (!exists) {
    throw new HttpsError(
      'failed-precondition',
      `El email ${email} no existe como contacto en T3 (organización ${cfg.organization}). Créalo en T3 o cambia el email del cliente en el panel.`,
    );
  }
}

async function assertDeviceForClient(uid, clientId, deviceId) {
  if (!clientId || !deviceId) {
    throw new HttpsError('invalid-argument', 'Faltan clientId o deviceId.');
  }
  const db = getFirestore();
  const deviceSnap = await db.collection('devices').doc(deviceId).get();
  if (!deviceSnap.exists) {
    throw new HttpsError('not-found', 'Dispositivo no registrado.');
  }
  const device = deviceSnap.data() || {};
  if (device.uid !== uid) {
    throw new HttpsError('permission-denied', 'El dispositivo no pertenece a esta sesión.');
  }
  if (device.clientId !== clientId) {
    throw new HttpsError('permission-denied', 'El dispositivo no pertenece a este cliente.');
  }
  const clientSnap = await db.collection('clients').doc(clientId).get();
  if (!clientSnap.exists || clientSnap.data()?.active !== true) {
    throw new HttpsError('failed-precondition', 'Cliente no válido o desactivado.');
  }
  const client = { id: clientSnap.id, ...clientSnap.data() };
  const email = String(client.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new HttpsError(
      'failed-precondition',
      'Este cliente no tiene email configurado. Contacta con TAEMSA.',
    );
  }
  return { client, email, device };
}

function callableOpts() {
  return {
    region: 'europe-west1',
    secrets: T3_SECRETS,
    timeoutSeconds: 120,
    memory: '512MiB',
  };
}

const MAX_FILES = 3;
const MAX_FILE_BYTES = 900 * 1024; // ~900 KB por foto (callable limit)

function normalizeTicketFiles(rawFiles) {
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) return [];
  if (rawFiles.length > MAX_FILES) {
    throw new HttpsError('invalid-argument', `Máximo ${MAX_FILES} fotos por incidencia.`);
  }
  return rawFiles.map((file, index) => {
    const name = String(file?.name || `foto-${index + 1}.jpg`).slice(0, 120);
    const mime = String(file?.mime || 'image/jpeg').slice(0, 80);
    const b64 = String(file?.contentBase64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!b64) {
      throw new HttpsError('invalid-argument', `La foto ${index + 1} está vacía.`);
    }
    let buffer;
    try {
      buffer = Buffer.from(b64, 'base64');
    } catch {
      throw new HttpsError('invalid-argument', `La foto ${index + 1} no es válida.`);
    }
    if (!buffer.length) {
      throw new HttpsError('invalid-argument', `La foto ${index + 1} está vacía.`);
    }
    if (buffer.length > MAX_FILE_BYTES) {
      throw new HttpsError(
        'invalid-argument',
        `La foto ${index + 1} es demasiado grande. Usa una imagen más ligera.`,
      );
    }
    // Muchas APIs .NET serializan byte[] como base64 en JSON.
    return {
      Name: name,
      Mime: mime,
      Content: b64,
    };
  });
}

exports.t3Catalog = onCall(callableOpts(), async (request) => {
  requireAuth(request);
  const cfg = t3Config();
  const jar = new CookieJar();
  await t3Login(cfg, jar);

  const [requestTypesRaw, typesRaw] = await Promise.all([
    t3Post(cfg.base, '/PublicAPI/GetRequestTypes', {
      organization: cfg.organization,
      language: T3_LANGUAGE,
    }, jar),
    t3Post(cfg.base, '/PublicAPI/GetTypes', {
      organization: cfg.organization,
      language: T3_LANGUAGE,
    }, jar),
  ]);

  return {
    language: T3_LANGUAGE,
    requestTypes: parseOptionsHtml(
      typeof requestTypesRaw === 'string' ? requestTypesRaw : String(requestTypesRaw ?? ''),
    ),
    types: parseOptionsHtml(
      typeof typesRaw === 'string' ? typesRaw : String(typesRaw ?? ''),
    ),
  };
});

exports.t3CreateTicket = onCall(callableOpts(), async (request) => {
  const uid = requireAuth(request);
  const {
    clientId,
    deviceId,
    body,
    files,
  } = request.data || {};

  const description = String(body || '').trim();
  // Sección y tipología fijas (no las elige el cliente).
  const reqType = T3_REQUEST_TYPE;
  const typology = T3_TYPE;
  if (!description) throw new HttpsError('invalid-argument', 'Describe la incidencia.');
  if (description.length > 8000) {
    throw new HttpsError('invalid-argument', 'La descripción es demasiado larga.');
  }

  const t3Files = normalizeTicketFiles(files);
  const { client, email, device } = await assertDeviceForClient(uid, clientId, deviceId);
  const cfg = t3Config();
  await assertContactEmail(cfg, email);
  const jar = new CookieJar();
  await t3Login(cfg, jar);

  const payload = {
    From: email,
    FromName: client.name || client.id,
    FromCompany: client.name || client.id,
    Company: cfg.company,
    Language: T3_LANGUAGE,
    Type: typology,
    RequestType: reqType,
    Version: `${client.id}${device.deviceName ? ` · ${device.deviceName}` : ''}`,
    Body: description,
    OriginalBody: description,
    Files: t3Files,
  };

  const result = await t3Post(cfg.base, '/App/Tiquet/Import', payload, jar);
  let code = '';
  let acceptedWithoutCode = false;
  if (typeof result === 'string' || typeof result === 'number') {
    code = String(result).trim();
    // Algunas versiones responden el booleano serializado como texto.
    if (code === 'true') {
      code = '';
      acceptedWithoutCode = true;
    }
  } else if (result === true) {
    acceptedWithoutCode = true;
  }

  if ((!code || code === '0' || code === 'false') && !acceptedWithoutCode) {
    console.error('t3CreateTicket unexpected Import result', {
      resultType: typeof result,
      result: typeof result === 'string' ? result.slice(0, 200) : result,
    });
    throw new HttpsError('internal', 'T3 no devolvió código de tiquet.');
  }

  if (!code && acceptedWithoutCode) {
    // T3 (esta instancia) responde true en lugar del código documentado.
    code = '';
  }

  const db = getFirestore();
  await db.collection('clients').doc(client.id).collection('tickets').add({
    code: code || '(sin código T3)',
    body: description,
    type: typology,
    requestType: reqType,
    deviceId,
    deviceName: device.deviceName || '',
    email,
    filesCount: t3Files.length,
    createdAt: FieldValue.serverTimestamp(),
    createdByUid: uid,
    t3RawResult: result === true || result === 'true' ? true : null,
  });

  return {
    code: code || null,
    accepted: true,
    filesCount: t3Files.length,
    requestType: reqType,
    type: typology,
  };
});

exports.t3MyTickets = onCall(callableOpts(), async (request) => {
  const uid = requireAuth(request);
  const { clientId, deviceId } = request.data || {};
  await assertDeviceForClient(uid, clientId, deviceId);

  const db = getFirestore();
  const snap = await db
    .collection('clients')
    .doc(clientId)
    .collection('tickets')
    .orderBy('createdAt', 'desc')
    .limit(30)
    .get();

  return {
    tickets: snap.docs.map((d) => {
      const data = d.data() || {};
      return {
        id: d.id,
        code: data.code || '',
        body: data.body || '',
        type: data.type || '',
        requestType: data.requestType || '',
        createdAt: data.createdAt?.toMillis?.() || null,
      };
    }),
  };
});
