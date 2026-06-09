import pg from 'pg'
import { createCipheriv, createDecipheriv, createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'

const { Pool } = pg

let pool
let ready

export const defaultAdmin = {
  name: 'Administrador',
  email: 'admin@jusprevconecta.com',
  password: 'JusPrev@2026',
  role: 'admin',
}

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(':')
  const candidate = hashPassword(password, salt).split(':')[1]
  return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'))
}

function safeEqualText(left = '', right = '') {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function base64UrlDecode(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

function getSessionSecret() {
  return process.env.SESSION_SECRET || process.env.DATABASE_URL || 'jusprevconecta-dev-secret'
}

function getEncryptionKey() {
  return createHash('sha256').update(process.env.SETTINGS_ENCRYPTION_KEY || getSessionSecret()).digest()
}

function encryptSecret(value = '') {
  if (!value) {
    return ''
  }

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`
}

function decryptSecret(value = '') {
  if (!value || !value.includes('.')) {
    return value || ''
  }

  const [ivText, tagText, encryptedText] = value.split('.')
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivText, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8')
}

export function createSessionToken(user) {
  const payload = {
    id: Number(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    exp: Date.now() + 1000 * 60 * 60 * 12,
  }
  const encodedPayload = base64UrlEncode(payload)
  const signature = createHmac('sha256', getSessionSecret()).update(encodedPayload).digest('base64url')
  return `${encodedPayload}.${signature}`
}

export function verifySessionToken(token) {
  if (!token || !token.includes('.')) {
    return null
  }

  const [encodedPayload, signature] = token.split('.')
  const expectedSignature = createHmac('sha256', getSessionSecret()).update(encodedPayload).digest('base64url')

  const signatureBuffer = Buffer.from(signature)
  const expectedSignatureBuffer = Buffer.from(expectedSignature)

  if (signatureBuffer.length !== expectedSignatureBuffer.length || !timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) {
    return null
  }

  const payload = base64UrlDecode(encodedPayload)

  if (!payload.exp || payload.exp < Date.now()) {
    return null
  }

  return payload
}

export function requireAuth(request, roles = []) {
  const header = request.headers.authorization || request.headers.Authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const user = verifySessionToken(token)

  if (!user) {
    const error = new Error('Sessao invalida ou expirada.')
    error.status = 401
    throw error
  }

  if (roles.length > 0 && !roles.includes(user.role)) {
    const error = new Error('Permissao insuficiente.')
    error.status = 403
    throw error
  }

  return user
}

export async function isSystemRegistered() {
  await ensureDatabase()
  const result = await getPool().query('SELECT 1 FROM system_registration WHERE id = 1 LIMIT 1')
  return result.rowCount > 0
}

export async function requireSystemRegistered() {
  if (process.env.ALLOW_UNREGISTERED_SYSTEM === 'true') {
    return
  }

  if (await isSystemRegistered()) {
    return
  }

  const error = new Error('Sistema ainda nao registrado. Acesse Configuracao > Seguranca e informe a chave de registro.')
  error.status = 423
  throw error
}

function getRequestMeta(request) {
  return {
    ip:
      request.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      request.headers['x-real-ip'] ||
      request.socket?.remoteAddress ||
      null,
    userAgent: request.headers['user-agent'] || null,
  }
}

const initialTemplates = [
  {
    title: 'Boas-vindas',
    body: 'Ola! Obrigado pelo contato. Ja recebemos sua mensagem e vamos te atender in instantes.',
  },
  {
    title: 'Enviar proposta',
    body: 'Segue a proposta conforme conversamos. Fico a disposicao para ajustar qualquer ponto.',
  },
  {
    title: 'Aguardando retorno',
    body: 'Passando para confirmar se conseguiu avaliar as informacoes. Posso te ajudar com mais alguma duvida?',
  },
  {
    title: 'Consentimento LGPD',
    body: 'Para continuar, preciso do seu consentimento para tratar seus dados pessoais apenas para fins de atendimento, triagem, organizacao de documentos e agendamento. Voce autoriza?',
  },
  {
    title: 'Triagem previdenciaria',
    body: 'Qual beneficio voce busca: aposentadoria, auxilio por incapacidade, BPC/LOAS, pensao por morte, salario-maternidade ou revisao de beneficio?',
  },
  {
    title: 'Orcamento de calculos',
    body: 'Para preparar o orcamento, me envie o tipo de calculo, numero do processo, vara, prazo desejado e se ja existe sentenca ou decisao para liquidacao.',
  },
]

const initialConversations = [
  {
    contact: 'Mariana Costa',
    company: 'Costa Decor',
    phone: '+55 71 98888-1200',
    email: 'mariana@costadecor.com',
    channel: 'whatsapp',
    subject: 'Orcamento para plano mensal',
    status: 'em_atendimento',
    priority: 'alta',
    responsible: 'Ana Paula',
    lastUpdate: '09:42',
    createdAt: '2026-05-30T09:21',
    scheduledAt: '2026-05-30T11:00',
    nextAction: 'Enviar proposta ate 11:00',
    messages: [
      ['client', 'Bom dia, vi o servico de voces e queria entender os planos.', '09:21'],
      ['agent', 'Bom dia, Mariana. Temos planos mensais e anuais. Posso te mandar a proposta resumida?', '09:29'],
      ['client', 'Pode sim. Tambem quero confirmar os valores e formas de pagamento.', '09:42'],
    ],
  },
  {
    contact: 'Roberto Lima',
    company: 'Lima Engenharia',
    phone: '+55 71 97777-4421',
    email: 'roberto@limaeng.com',
    channel: 'email',
    subject: 'Re: proposta comercial',
    status: 'retorno',
    priority: 'normal',
    responsible: 'Carlos Mendes',
    lastUpdate: '08:15',
    createdAt: '2026-05-30T08:15',
    scheduledAt: '2026-05-30T16:30',
    nextAction: 'Retornar com contrato revisado hoje',
    messages: [
      ['client', 'Enviei os documentos solicitados para avaliacao.', '08:15'],
      ['agent', 'Recebido, Roberto. Vou revisar e te devolver com o contrato atualizado.', '08:31'],
    ],
  },
]

const initialCalculations = [
  {
    kind: 'judicial',
    clientName: 'Mariana Costa',
    reference: 'Processo trabalhista - liquidacao',
    description: 'Previa assistida para verbas rescisorias, reflexos e atualizacao.',
    principal: 8500,
    correction: 620,
    interest: 410,
    fees: 0,
    estimatedTotal: 9530,
    status: 'em_revisao',
    createdAt: '2026-05-30T09:40',
  },
  {
    kind: 'previdenciario',
    clientName: 'Roberto Lima',
    reference: 'Revisao de beneficio',
    description: 'Previa de atrasados para revisao previdenciaria, sujeita a analise documental.',
    principal: 12000,
    correction: 880,
    interest: 360,
    fees: 0,
    estimatedTotal: 13240,
    status: 'rascunho',
    createdAt: '2026-05-30T10:15',
  },
]

export function sendJson(response, status, payload) {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.status(status).json(payload)
}

export function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    const error = new Error('DATABASE_URL nao configurada.')
    error.status = 503
    throw error
  }
}

export function getPool() {
  requireDatabaseUrl()

  if (!pool) {
    // Remove qualquer parâmetro de query da string que possa forçar um SSL incorreto
    const cleanUrl = process.env.DATABASE_URL.split('?')[0]
    const isLocalhost = cleanUrl.includes('localhost') || cleanUrl.includes('127.0.0.1')

    pool = new Pool({
      connectionString: cleanUrl,
      // Configurações para evitar travamentos de Timeout:
      connectionTimeoutMillis: 5000, // Desiste após 5 segundos se o banco não responder
      idleTimeoutMillis: 10000,       // Fecha conexões inativas após 10 segundos
      max: 10,                        // Limite máximo de conexões simultâneas
      ssl: isLocalhost ? false : { rejectUnauthorized: false }
    })

    // Captura erros silenciosos no Pool para expor no log da Vercel
    pool.on('error', (err) => {
      console.error('❌ Erro inesperado no Pool do PostgreSQL:', err)
    })
  }

  return pool
}export async function ensureDatabase() {
  if (!ready) {
    ready = setupDatabase()
  }

  return ready
}

async function setupDatabase() {
  const client = await getPool().connect()

  try {
    await client.query('BEGIN')
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id BIGSERIAL PRIMARY KEY,
        contact TEXT NOT NULL,
        company TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT NOT NULL,
        channel TEXT NOT NULL,
        subject TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        responsible TEXT NOT NULL,
        last_update TEXT NOT NULL,
        created_at TEXT,
        scheduled_at TEXT,
        next_action TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
        conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        author TEXT NOT NULL,
        text TEXT NOT NULL,
        time TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS templates (
        id BIGSERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS calculations (
        id BIGSERIAL PRIMARY KEY,
        kind TEXT NOT NULL,
        formula TEXT NOT NULL DEFAULT 'livre',
        client_name TEXT NOT NULL,
        reference TEXT NOT NULL,
        description TEXT NOT NULL,
        principal NUMERIC NOT NULL DEFAULT 0,
        correction NUMERIC NOT NULL DEFAULT 0,
        interest NUMERIC NOT NULL DEFAULT 0,
        fees NUMERIC NOT NULL DEFAULT 0,
        estimated_total NUMERIC NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS broadcasts (
        id BIGSERIAL PRIMARY KEY,
        channel TEXT NOT NULL,
        name TEXT NOT NULL,
        subject TEXT,
        sender_account TEXT,
        whatsapp_template_name TEXT,
        whatsapp_template_language TEXT,
        message TEXT NOT NULL,
        recipients TEXT NOT NULL,
        recipient_count INTEGER NOT NULL DEFAULT 0,
        sent_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        scheduled_at TEXT,
        created_by BIGINT,
        created_by_email TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS broadcast_deliveries (
        id BIGSERIAL PRIMARY KEY,
        broadcast_id BIGINT REFERENCES broadcasts(id) ON DELETE CASCADE,
        channel TEXT NOT NULL DEFAULT 'whatsapp',
        recipient TEXT NOT NULL,
        provider_message_id TEXT,
        status TEXT NOT NULL DEFAULT 'api_sent',
        last_error TEXT,
        last_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
        id BIGSERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        provider_message_id TEXT,
        recipient TEXT,
        status TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT,
        user_name TEXT,
        user_email TEXT,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT,
        summary TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        ip_address TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS system_registration (
        id INTEGER PRIMARY KEY DEFAULT 1,
        key_fingerprint TEXT NOT NULL,
        registered_by BIGINT,
        registered_by_email TEXT,
        registered_at TEXT NOT NULL,
        CONSTRAINT single_system_registration CHECK (id = 1)
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_by BIGINT,
        updated_by_email TEXT,
        updated_at TEXT NOT NULL
      );

      ALTER TABLE calculations ADD COLUMN IF NOT EXISTS formula TEXT NOT NULL DEFAULT 'livre';
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS updated_at TEXT;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS updated_by BIGINT;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE templates ADD COLUMN IF NOT EXISTS updated_at TEXT;
      ALTER TABLE templates ADD COLUMN IF NOT EXISTS updated_by BIGINT;
      ALTER TABLE templates ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE calculations ADD COLUMN IF NOT EXISTS updated_at TEXT;
      ALTER TABLE calculations ADD COLUMN IF NOT EXISTS updated_by BIGINT;
      ALTER TABLE calculations ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS updated_at TEXT;
      ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS updated_by BIGINT;
      ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS sender_account TEXT;
      ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS whatsapp_template_name TEXT;
      ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS whatsapp_template_language TEXT;
      ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS sent_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS failed_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE broadcast_deliveries ADD COLUMN IF NOT EXISTS last_error TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_by BIGINT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

      CREATE UNIQUE INDEX IF NOT EXISTS broadcast_deliveries_provider_message_id_idx
      ON broadcast_deliveries(provider_message_id)
      WHERE provider_message_id IS NOT NULL;
    `)

    const templateCount = Number((await client.query('SELECT COUNT(*) AS total FROM templates')).rows[0].total)
    const conversationCount = Number((await client.query('SELECT COUNT(*) AS total FROM conversations')).rows[0].total)
    const calculationCount = Number((await client.query('SELECT COUNT(*) AS total FROM calculations')).rows[0].total)
    const userCount = Number((await client.query('SELECT COUNT(*) AS total FROM users')).rows[0].total)

    if (templateCount === 0) {
      for (const template of initialTemplates) {
        await client.query('INSERT INTO templates (title, body) VALUES ($1, $2)', [template.title, template.body])
      }
    }

    if (conversationCount === 0) {
      for (const conversation of initialConversations) {
        const inserted = await client.query(
          `
            INSERT INTO conversations (
              contact, company, phone, email, channel, subject, status, priority,
              responsible, last_update, created_at, scheduled_at, next_action
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id
          `,
          [
            conversation.contact,
            conversation.company,
            conversation.phone,
            conversation.email,
            conversation.channel,
            conversation.subject,
            conversation.status,
            conversation.priority,
            conversation.responsible,
            conversation.lastUpdate,
            conversation.createdAt,
            conversation.scheduledAt,
            conversation.nextAction,
          ],
        )

        for (const [author, text, time] of conversation.messages) {
          await client.query('INSERT INTO messages (conversation_id, author, text, time) VALUES ($1, $2, $3, $4)', [
            inserted.rows[0].id,
            author,
            text,
            time,
          ])
        }
      }
    }

    if (calculationCount === 0) {
      for (const calculation of initialCalculations) {
        await client.query(
          `
            INSERT INTO calculations (
              kind, client_name, reference, description, principal, correction,
              interest, fees, estimated_total, status, created_at, formula
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          `,
          [
            calculation.kind,
            calculation.clientName,
            calculation.reference,
            calculation.description,
            calculation.principal,
            calculation.correction,
            calculation.interest,
            calculation.fees,
            calculation.estimatedTotal,
            calculation.status,
            calculation.createdAt,
            calculation.formula ?? 'livre',
          ],
        )
      }
    }

    if (userCount === 0) {
      await client.query(
        'INSERT INTO users (name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)',
        [
          defaultAdmin.name,
          defaultAdmin.email,
          hashPassword(defaultAdmin.password),
          defaultAdmin.role,
          new Date().toISOString(),
        ],
      )
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export function mapConversation(row) {
  return {
    id: Number(row.id),
    contact: row.contact,
    company: row.company,
    phone: row.phone,
    email: row.email,
    channel: row.channel,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    responsible: row.responsible,
    lastUpdate: row.last_update,
    createdAt: row.created_at,
    scheduledAt: row.scheduled_at,
    nextAction: row.next_action,
    messages: [],
  }
}

export async function getConversations() {
  await ensureDatabase()

  const [conversationRows, messageRows] = await Promise.all([
    getPool().query('SELECT * FROM conversations ORDER BY id DESC'),
    getPool().query('SELECT * FROM messages ORDER BY id ASC'),
  ])
  const byConversation = new Map()

  conversationRows.rows.forEach((row) => byConversation.set(Number(row.id), mapConversation(row)))
  messageRows.rows.forEach((message) => {
    const conversation = byConversation.get(Number(message.conversation_id))

    if (conversation) {
      conversation.messages.push({
        id: Number(message.id),
        author: message.author,
        text: message.text,
        time: message.time,
      })
    }
  })

  return [...byConversation.values()]
}

export async function getConversation(id) {
  const conversations = await getConversations()
  return conversations.find((conversation) => conversation.id === Number(id))
}

export function mapCalculation(row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    formula: row.formula ?? 'livre',
    clientName: row.client_name,
    reference: row.reference,
    description: row.description,
    principal: Number(row.principal),
    correction: Number(row.correction),
    interest: Number(row.interest),
    fees: Number(row.fees),
    estimatedTotal: Number(row.estimated_total),
    status: row.status,
    createdAt: row.created_at,
  }
}

export async function getCalculations() {
  await ensureDatabase()
  const result = await getPool().query('SELECT * FROM calculations ORDER BY id DESC')
  return result.rows.map(mapCalculation)
}

export function mapBroadcast(row) {
  return {
    id: Number(row.id),
    channel: row.channel,
    name: row.name,
    subject: row.subject,
    senderAccount: row.sender_account,
    whatsappTemplateName: row.whatsapp_template_name,
    whatsappTemplateLanguage: row.whatsapp_template_language,
    message: row.message,
    recipients: row.recipients,
    recipientCount: Number(row.recipient_count),
    sentCount: Number(row.sent_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    status: row.status,
    scheduledAt: row.scheduled_at,
    createdBy: row.created_by ? Number(row.created_by) : null,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
  }
}

export async function getBroadcasts() {
  await ensureDatabase()
  const result = await getPool().query('SELECT * FROM broadcasts ORDER BY id DESC')
  return result.rows.map(mapBroadcast)
}

async function refreshBroadcastDeliveryCounts(broadcastId) {
  if (!broadcastId) {
    return
  }

  await getPool().query(
    `
      UPDATE broadcasts
      SET
        sent_count = (
          SELECT COUNT(*)
          FROM broadcast_deliveries
          WHERE broadcast_id = $1
            AND status IN ('api_sent', 'sent', 'delivered', 'read')
        ),
        failed_count = (
          SELECT COUNT(*)
          FROM broadcast_deliveries
          WHERE broadcast_id = $1
            AND status = 'failed'
        ),
        updated_at = $2,
        version = version + 1
      WHERE id = $1
    `,
    [broadcastId, new Date().toISOString()],
  )
}

export async function recordBroadcastDelivery({ broadcastId, recipient, providerMessageId, status = 'api_sent', payload = {}, errorMessage = '' }) {
  await ensureDatabase()

  const now = new Date().toISOString()
  const result = await getPool().query(
    `
      INSERT INTO broadcast_deliveries (
        broadcast_id, channel, recipient, provider_message_id, status, last_error, last_payload, created_at, updated_at
      ) VALUES ($1, 'whatsapp', $2, $3, $4, $5, $6, $7, $7)
      ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL
      DO UPDATE SET
        broadcast_id = COALESCE(EXCLUDED.broadcast_id, broadcast_deliveries.broadcast_id),
        recipient = EXCLUDED.recipient,
        status = EXCLUDED.status,
        last_error = EXCLUDED.last_error,
        last_payload = EXCLUDED.last_payload,
        updated_at = EXCLUDED.updated_at
      RETURNING broadcast_id
    `,
    [broadcastId || null, recipient, providerMessageId || null, status, errorMessage || null, payload, now],
  )

  await refreshBroadcastDeliveryCounts(result.rows[0]?.broadcast_id || broadcastId)
}

export async function recordWhatsAppWebhookEvent({ eventType, providerMessageId, recipient, status, payload = {} }) {
  await ensureDatabase()

  await getPool().query(
    `
      INSERT INTO whatsapp_webhook_events (
        event_type, provider_message_id, recipient, status, payload, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [eventType, providerMessageId || null, recipient || null, status || null, payload, new Date().toISOString()],
  )
}

export async function updateWhatsAppDeliveryStatus({ providerMessageId, recipient, status, payload = {}, errorMessage = '' }) {
  await ensureDatabase()

  if (!providerMessageId) {
    return
  }

  const result = await getPool().query(
    `
      UPDATE broadcast_deliveries
      SET
        recipient = COALESCE($2, recipient),
        status = $3,
        last_error = $4,
        last_payload = $5,
        updated_at = $6
      WHERE provider_message_id = $1
      RETURNING broadcast_id
    `,
    [providerMessageId, recipient || null, status, errorMessage || null, payload, new Date().toISOString()],
  )

  await refreshBroadcastDeliveryCounts(result.rows[0]?.broadcast_id)
}

export function mapUser(row) {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
  }
}

export async function getUsers() {
  await ensureDatabase()
  const result = await getPool().query('SELECT id, name, email, role, created_at FROM users ORDER BY id DESC')
  return result.rows.map(mapUser)
}

export function mapAuditLog(row) {
  return {
    id: Number(row.id),
    userId: row.user_id ? Number(row.user_id) : null,
    userName: row.user_name,
    userEmail: row.user_email,
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id,
    summary: row.summary,
    metadata: row.metadata ?? {},
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  }
}

export async function getAuditLogs({ limit = 100, action = '', userEmail = '', dateFrom = '', dateTo = '' } = {}) {
  await ensureDatabase()
  const filters = []
  const params = []

  if (action) {
    params.push(action)
    filters.push(`action = $${params.length}`)
  }

  if (userEmail) {
    params.push(`%${userEmail.toLowerCase()}%`)
    filters.push(`lower(coalesce(user_email, '')) LIKE $${params.length}`)
  }

  if (dateFrom) {
    params.push(dateFrom)
    filters.push(`created_at >= $${params.length}`)
  }

  if (dateTo) {
    params.push(dateTo)
    filters.push(`created_at <= $${params.length}`)
  }

  params.push(Math.min(Number(limit) || 100, 300))
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
  const result = await getPool().query(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT $${params.length}`, params)
  return result.rows.map(mapAuditLog)
}

export async function getSystemStatus() {
  await ensureDatabase()
  const pool = getPool()
  const [
    databaseNow,
    registration,
    conversations,
    messages,
    templates,
    calculations,
    broadcasts,
    users,
    auditLogs,
    lastAudit,
  ] = await Promise.all([
    pool.query('SELECT NOW() AS now'),
    pool.query('SELECT * FROM system_registration WHERE id = 1'),
    pool.query('SELECT COUNT(*) AS total FROM conversations'),
    pool.query('SELECT COUNT(*) AS total FROM messages'),
    pool.query('SELECT COUNT(*) AS total FROM templates'),
    pool.query('SELECT COUNT(*) AS total FROM calculations'),
    pool.query('SELECT COUNT(*) AS total FROM broadcasts'),
    pool.query('SELECT COUNT(*) AS total FROM users'),
    pool.query('SELECT COUNT(*) AS total FROM audit_logs'),
    pool.query('SELECT created_at FROM audit_logs ORDER BY id DESC LIMIT 1'),
  ])
  const registrationRow = registration.rows[0]

  return {
    database: {
      ok: true,
      provider: 'PostgreSQL',
      checkedAt: databaseNow.rows[0].now,
    },
    registration: {
      registered: Boolean(registrationRow),
      registeredAt: registrationRow?.registered_at ?? null,
      registeredByEmail: registrationRow?.registered_by_email ?? null,
      fingerprint: registrationRow?.key_fingerprint ?? null,
      keyConfigured: Boolean(process.env.SYSTEM_REGISTRATION_KEY),
    },
    counts: {
      conversations: Number(conversations.rows[0].total),
      messages: Number(messages.rows[0].total),
      templates: Number(templates.rows[0].total),
      calculations: Number(calculations.rows[0].total),
      broadcasts: Number(broadcasts.rows[0].total),
      users: Number(users.rows[0].total),
      auditLogs: Number(auditLogs.rows[0].total),
    },
    lastAuditAt: lastAudit.rows[0]?.created_at ?? null,
  }
}

export async function getEmailSettings({ includeSecrets = false } = {}) {
  await ensureDatabase()
  const result = await getPool().query("SELECT value FROM system_settings WHERE key = 'email_accounts'")
  const accounts = Array.isArray(result.rows[0]?.value?.accounts) ? result.rows[0].value.accounts : []

  return {
    accounts: accounts.map((account) => ({
      id: String(account.id || ''),
      label: String(account.label || account.id || ''),
      host: String(account.host || ''),
      port: Number(account.port || 587),
      secure: Boolean(account.secure),
      user: String(account.user || ''),
      from: String(account.from || ''),
      pass: includeSecrets ? decryptSecret(account.pass || '') : '',
      hasPassword: Boolean(account.pass),
    })),
  }
}

export async function saveEmailSettings(accounts = [], user, request) {
  await ensureDatabase()
  const normalizedAccounts = accounts
    .filter((account) => account?.id && account?.host && account?.user && account?.from)
    .map((account) => ({
      id: String(account.id).trim(),
      label: String(account.label || account.id).trim(),
      host: String(account.host).trim(),
      port: Number(account.port || 587),
      secure: Boolean(account.secure),
      user: String(account.user).trim(),
      from: String(account.from).trim(),
      pass: account.pass ? encryptSecret(account.pass) : String(account.existingPass || ''),
    }))

  await getPool().query(
    `
      INSERT INTO system_settings (key, value, updated_by, updated_by_email, updated_at)
      VALUES ('email_accounts', $1, $2, $3, $4)
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_by = EXCLUDED.updated_by,
        updated_by_email = EXCLUDED.updated_by_email,
        updated_at = EXCLUDED.updated_at
    `,
    [JSON.stringify({ accounts: normalizedAccounts }), user.id, user.email, new Date().toISOString()],
  )

  await logAudit({
    request,
    user,
    action: 'email_settings_updated',
    entity: 'system',
    summary: `Configuracao de e-mail atualizada com ${normalizedAccounts.length} conta(s).`,
    metadata: { accounts: normalizedAccounts.map((account) => ({ id: account.id, label: account.label, from: account.from })) },
  })

  return getEmailSettings()
}

export async function getCompanySettings() {
  await ensureDatabase()
  const result = await getPool().query("SELECT value FROM system_settings WHERE key = 'company_profile'")
  const profile = result.rows[0]?.value || {}

  return {
    name: String(profile.name || 'JusPrevConecta'),
    tradeName: String(profile.tradeName || 'JusPrevConecta'),
    document: String(profile.document || ''),
    stateRegistration: String(profile.stateRegistration || ''),
    municipalRegistration: String(profile.municipalRegistration || ''),
    responsible: String(profile.responsible || ''),
    phone: String(profile.phone || ''),
    whatsapp: String(profile.whatsapp || ''),
    email: String(profile.email || ''),
    website: String(profile.website || ''),
    address: String(profile.address || ''),
    city: String(profile.city || ''),
    state: String(profile.state || ''),
    zipCode: String(profile.zipCode || ''),
    logoDataUrl: String(profile.logoDataUrl || ''),
  }
}

export async function saveCompanySettings(profile = {}, user, request) {
  await ensureDatabase()
  const normalizedProfile = {
    name: String(profile.name || '').trim(),
    tradeName: String(profile.tradeName || profile.name || '').trim(),
    document: String(profile.document || '').trim(),
    stateRegistration: String(profile.stateRegistration || '').trim(),
    municipalRegistration: String(profile.municipalRegistration || '').trim(),
    responsible: String(profile.responsible || '').trim(),
    phone: String(profile.phone || '').trim(),
    whatsapp: String(profile.whatsapp || '').trim(),
    email: String(profile.email || '').trim(),
    website: String(profile.website || '').trim(),
    address: String(profile.address || '').trim(),
    city: String(profile.city || '').trim(),
    state: String(profile.state || '').trim(),
    zipCode: String(profile.zipCode || '').trim(),
    logoDataUrl: String(profile.logoDataUrl || '').startsWith('data:image/') ? String(profile.logoDataUrl) : '',
  }

  await getPool().query(
    `
      INSERT INTO system_settings (key, value, updated_by, updated_by_email, updated_at)
      VALUES ('company_profile', $1, $2, $3, $4)
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_by = EXCLUDED.updated_by,
        updated_by_email = EXCLUDED.updated_by_email,
        updated_at = EXCLUDED.updated_at
    `,
    [JSON.stringify(normalizedProfile), user.id, user.email, new Date().toISOString()],
  )

  await logAudit({
    request,
    user,
    action: 'company_settings_updated',
    entity: 'system',
    summary: `Perfil da empresa atualizado: ${normalizedProfile.tradeName}.`,
    metadata: { profile: { name: normalizedProfile.name, document: normalizedProfile.document } },
  })

  return getCompanySettings()
}

export async function logAudit({ request, user, action, entity, entityId = null, summary, metadata = {} }) {
  try {
    await ensureDatabase()
    const meta = getRequestMeta(request)
    await getPool().query(
      `
        INSERT INTO audit_logs (
          user_id, user_name, user_email, action, entity, entity_id, summary, metadata, ip_address, user_agent, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        user?.id ? Number(user.id) : null,
        user?.name || null,
        user?.email || null,
        action,
        entity,
        entityId ? String(entityId) : null,
        summary,
        JSON.stringify(metadata),
        meta.ip,
        meta.userAgent,
        new Date().toISOString(),
      ],
    )
  } catch (err) {
    console.error('❌ Falha ao gravar log de auditoria:', err.message)
  }
}

export function handleApiError(response, error) {
  console.error('❌ Erro na API:', error)
  const status = Number(error.status) || 500
  const message = error.status ? error.message : 'Erro interno do servidor.'
  sendJson(response, status, { error: message })
}