import { createServer } from 'node:http'
import { createCipheriv, createDecipheriv, createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import nodemailer from 'nodemailer'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, 'data')
const dbPath = join(dataDir, 'controle360.sqlite')
const port = Number(process.env.API_PORT ?? 4000)

mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(dbPath)

const defaultAdmin = {
  name: 'Administrador',
  email: 'admin@jusprevconecta.com',
  password: 'JusPrev@2026',
  role: 'admin',
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, storedHash) {
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
  return process.env.SESSION_SECRET || 'jusprevconecta-dev-secret'
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

function createSessionToken(user) {
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

function verifySessionToken(token) {
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

function requireAuth(request, roles = []) {
  const header = request.headers.authorization || ''
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

function isSystemRegistered() {
  const row = db.prepare('SELECT 1 FROM system_registration WHERE id = 1 LIMIT 1').get()
  return Boolean(row)
}

function requireSystemRegistered() {
  if (process.env.ALLOW_UNREGISTERED_SYSTEM === 'true') {
    return
  }

  if (isSystemRegistered()) {
    return
  }

  const error = new Error('Sistema ainda nao registrado. Acesse Configuracao > Seguranca e informe a chave de registro.')
  error.status = 423
  throw error
}

const initialTemplates = [
  {
    title: 'Boas-vindas',
    body: 'Ola! Obrigado pelo contato. Ja recebemos sua mensagem e vamos te atender em instantes.',
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

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    time TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS calculations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    formula TEXT NOT NULL DEFAULT 'livre',
    client_name TEXT NOT NULL,
    reference TEXT NOT NULL,
    description TEXT NOT NULL,
    principal REAL NOT NULL DEFAULT 0,
    correction REAL NOT NULL DEFAULT 0,
    interest REAL NOT NULL DEFAULT 0,
    fees REAL NOT NULL DEFAULT 0,
    estimated_total REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS broadcasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    created_by INTEGER,
    created_by_email TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_name TEXT,
    user_email TEXT,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    summary TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS system_registration (
    id INTEGER PRIMARY KEY DEFAULT 1,
    key_fingerprint TEXT NOT NULL,
    registered_by INTEGER,
    registered_by_email TEXT,
    registered_at TEXT NOT NULL,
    CHECK (id = 1)
  );

  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '{}',
    updated_by INTEGER,
    updated_by_email TEXT,
    updated_at TEXT NOT NULL
  );
`)

try {
  db.exec("ALTER TABLE calculations ADD COLUMN formula TEXT NOT NULL DEFAULT 'livre'")
} catch {
  // Column already exists in previously initialized local databases.
}

for (const table of ['conversations', 'templates', 'calculations', 'broadcasts', 'users']) {
  for (const [column, definition] of [
    ['updated_at', 'TEXT'],
    ['updated_by', 'INTEGER'],
    ['version', 'INTEGER NOT NULL DEFAULT 1'],
  ]) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    } catch {
      // Column already exists in previously initialized local databases.
    }
  }
}

try {
  db.exec('ALTER TABLE broadcasts ADD COLUMN sender_account TEXT')
} catch {
  // Column already exists in previously initialized local databases.
}

for (const [column, definition] of [
  ['whatsapp_template_name', 'TEXT'],
  ['whatsapp_template_language', 'TEXT'],
  ['sent_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['failed_count', 'INTEGER NOT NULL DEFAULT 0'],
]) {
  try {
    db.exec(`ALTER TABLE broadcasts ADD COLUMN ${column} ${definition}`)
  } catch {
    // Column already exists in previously initialized local databases.
  }
}

seedDatabase()

function seedDatabase() {
  const conversationCount = db.prepare('SELECT COUNT(*) AS total FROM conversations').get().total
  const templateCount = db.prepare('SELECT COUNT(*) AS total FROM templates').get().total
  const userCount = db.prepare('SELECT COUNT(*) AS total FROM users').get().total

  if (templateCount === 0) {
    const insertTemplate = db.prepare('INSERT INTO templates (title, body) VALUES (?, ?)')
    initialTemplates.forEach((template) => insertTemplate.run(template.title, template.body))
  }

  if (conversationCount === 0) {
    const insertConversation = db.prepare(`
      INSERT INTO conversations (
        contact, company, phone, email, channel, subject, status, priority,
        responsible, last_update, created_at, scheduled_at, next_action
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertMessage = db.prepare(`
      INSERT INTO messages (conversation_id, author, text, time) VALUES (?, ?, ?, ?)
    `)

    initialConversations.forEach((conversation) => {
      const result = insertConversation.run(
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
      )

      conversation.messages.forEach(([author, text, time]) => {
        insertMessage.run(result.lastInsertRowid, author, text, time)
      })
    })
  }

  if (userCount === 0) {
    db.prepare('INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(
      defaultAdmin.name,
      defaultAdmin.email,
      hashPassword(defaultAdmin.password),
      defaultAdmin.role,
      new Date().toISOString(),
    )
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(payload))
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(error)
      }
    })
  })
}

function mapConversation(row) {
  return {
    id: row.id,
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

function getConversations() {
  const rows = db.prepare('SELECT * FROM conversations ORDER BY id DESC').all()
  const messages = db.prepare('SELECT * FROM messages ORDER BY id ASC').all()
  const byConversation = new Map()

  rows.forEach((row) => byConversation.set(row.id, mapConversation(row)))
  messages.forEach((message) => {
    const conversation = byConversation.get(message.conversation_id)

    if (conversation) {
      conversation.messages.push({
        id: message.id,
        author: message.author,
        text: message.text,
        time: message.time,
      })
    }
  })

  return [...byConversation.values()]
}

function getTemplates() {
  return db.prepare('SELECT id, title, body FROM templates ORDER BY id DESC').all()
}

function mapCalculation(row) {
  return {
    id: row.id,
    kind: row.kind,
    formula: row.formula ?? 'livre',
    clientName: row.client_name,
    reference: row.reference,
    description: row.description,
    principal: row.principal,
    correction: row.correction,
    interest: row.interest,
    fees: row.fees,
    estimatedTotal: row.estimated_total,
    status: row.status,
    createdAt: row.created_at,
  }
}

function getCalculations() {
  return db.prepare('SELECT * FROM calculations ORDER BY id DESC').all().map(mapCalculation)
}

function mapBroadcast(row) {
  return {
    id: row.id,
    channel: row.channel,
    name: row.name,
    subject: row.subject,
    senderAccount: row.sender_account,
    whatsappTemplateName: row.whatsapp_template_name,
    whatsappTemplateLanguage: row.whatsapp_template_language,
    message: row.message,
    recipients: row.recipients,
    recipientCount: row.recipient_count,
    sentCount: row.sent_count ?? 0,
    failedCount: row.failed_count ?? 0,
    status: row.status,
    scheduledAt: row.scheduled_at,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
  }
}

function getBroadcasts() {
  return db.prepare('SELECT * FROM broadcasts ORDER BY id DESC').all().map(mapBroadcast)
}

function countRecipients(recipients = '') {
  return recipients
    .split(/\r?\n|,/)
    .map((recipient) => recipient.trim())
    .filter(Boolean).length
}

function parseRecipients(recipients = '') {
  return recipients
    .split(/\r?\n|,/)
    .map((recipient) => recipient.trim())
    .filter(Boolean)
}

function normalizeWhatsAppRecipient(recipient = '') {
  const digits = recipient.replace(/\D/g, '')

  if (!digits) {
    return ''
  }

  if (digits.startsWith('55') || digits.length > 11) {
    return digits
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`
  }

  return digits
}

function getEmailAccounts() {
  const savedSettings = getEmailSettings({ includeSecrets: true })
  if (savedSettings.accounts.length > 0) {
    return savedSettings.accounts
      .filter((account) => account.id && account.host && account.user && account.pass && account.from)
      .map((account) => ({
        id: account.id,
        label: account.label || account.id,
        host: account.host,
        port: Number(account.port || 587),
        secure: Boolean(account.secure),
        user: account.user,
        pass: account.pass,
        from: account.from,
      }))
  }

  if (process.env.EMAIL_ACCOUNTS_JSON) {
    try {
      const accounts = JSON.parse(process.env.EMAIL_ACCOUNTS_JSON)
      if (Array.isArray(accounts)) {
        return accounts
          .filter((account) => account?.id && account?.host && account?.user && account?.pass && account?.from)
          .map((account) => ({
            id: String(account.id),
            label: String(account.label || account.id),
            host: String(account.host),
            port: Number(account.port || 587),
            secure: account.secure === true || account.secure === 'true',
            user: String(account.user),
            pass: String(account.pass),
            from: String(account.from),
          }))
      }
    } catch {
      return []
    }
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.EMAIL_FROM) {
    return [
      {
        id: 'principal',
        label: 'Conta principal',
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
        from: process.env.EMAIL_FROM,
      },
    ]
  }

  return []
}

function getPublicEmailAccounts() {
  return getEmailAccounts().map(({ id, label, from }) => ({ id, label, from }))
}

function getEmailAccount(accountId) {
  const accounts = getEmailAccounts()
  return accounts.find((account) => account.id === accountId) || accounts[0] || null
}

function getIntegrationStatus() {
  const emailAccounts = getPublicEmailAccounts()

  return {
    whatsapp: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
    email: emailAccounts.length > 0,
    whatsappVersion: process.env.WHATSAPP_GRAPH_VERSION || 'v23.0',
    emailFrom: emailAccounts[0]?.from || null,
    emailAccounts,
  }
}

function getWhatsAppErrorHint(code) {
  const hints = {
    190: 'Token invalido ou expirado. Gere um novo token na Meta, atualize WHATSAPP_ACCESS_TOKEN na Vercel e faca um redeploy.',
    131030: 'O telefone do destinatario nao esta liberado na lista de teste da Meta. Adicione e confirme esse numero em "Enviar e receber mensagens".',
    131058: 'O modelo hello_world so pode ser enviado pelo numero publico de teste da Meta. Para numero proprio, use um modelo aprovado no Gerenciador do WhatsApp.',
  }

  return hints[code] || ''
}

function getEmailErrorHint(error) {
  const message = error instanceof Error ? error.message : String(error || '')

  if (message.includes('535') || /username and password/i.test(message)) {
    return 'Falha de login SMTP. No Gmail, gere uma Senha de app e use essa senha no cadastro da conta de e-mail.'
  }

  if (/self[- ]signed|certificate|tls/i.test(message)) {
    return 'Falha de seguranca TLS/SSL. Confira porta 587 com TLS desligado no campo SSL, ou porta 465 com SSL ligado.'
  }

  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAUTH/i.test(message)) {
    return 'Nao foi possivel conectar ao servidor SMTP. Confira host, porta, usuario, senha e bloqueios do provedor.'
  }

  return ''
}

async function sendWhatsAppMessage(to, message, templateName, templateLanguage = 'en_US') {
  const version = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0'
  const normalizedTo = normalizeWhatsAppRecipient(to)
  const body = templateName
    ? {
        messaging_product: 'whatsapp',
        to: normalizedTo,
        type: 'template',
        template: {
          name: templateName,
          language: { code: templateLanguage || 'en_US' },
        },
      }
    : {
        messaging_product: 'whatsapp',
        to: normalizedTo,
        type: 'text',
        text: { preview_url: false, body: message },
      }

  const result = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!result.ok) {
    let details = ''
    try {
      const rawBody = await result.text()
      const payload = rawBody ? JSON.parse(rawBody) : null
      const message = payload?.error?.message || payload?.error?.error_user_msg || rawBody
      const code = payload?.error?.code ? ` codigo ${payload.error.code}` : ''
      const type = payload?.error?.type ? ` ${payload.error.type}` : ''
      const hint = getWhatsAppErrorHint(payload?.error?.code)
      details = message ? `:${type}${code} - ${message}${hint ? ` | ${hint}` : ''}` : ''
    } catch {
      details = ''
    }
    throw new Error(`WhatsApp respondeu ${result.status}${details}`)
  }
}

async function sendEmailMessage(to, subject, message, accountId) {
  const account = getEmailAccount(accountId)

  if (!account) {
    throw new Error('Conta de e-mail nao configurada.')
  }

  const transporter = nodemailer.createTransport({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: {
      user: account.user,
      pass: account.pass,
    },
  })

  await transporter.sendMail({
    from: account.from,
    to,
    subject: subject || 'JusPrevConecta',
    text: message,
  })
}

async function sendBroadcast(broadcast) {
  const status = getIntegrationStatus()
  const configured = broadcast.channel === 'whatsapp' ? status.whatsapp : status.email

  if (!configured) {
    return { sent: 0, failed: broadcast.recipientCount, error: `Integracao de ${broadcast.channel === 'whatsapp' ? 'WhatsApp' : 'e-mail'} ainda nao configurada.` }
  }

  let sent = 0
  let failed = 0
  const errors = []

  for (const recipient of parseRecipients(broadcast.recipients)) {
    try {
      if (broadcast.channel === 'whatsapp') {
        await sendWhatsAppMessage(recipient, broadcast.message, broadcast.whatsappTemplateName, broadcast.whatsappTemplateLanguage)
      } else {
        try {
          await sendEmailMessage(recipient, broadcast.subject, broadcast.message, broadcast.senderAccount)
        } catch (error) {
          const hint = getEmailErrorHint(error)
          throw new Error(`${error instanceof Error ? error.message : 'Falha no envio de e-mail.'}${hint ? ` | ${hint}` : ''}`)
        }
      }
      sent += 1
    } catch (error) {
      failed += 1
      errors.push({
        recipient,
        message: error instanceof Error ? error.message : 'Falha desconhecida no envio.',
      })
    }
  }

  return { sent, failed, errors, error: sent === 0 && errors[0] ? errors[0].message : undefined }
}

async function processScheduledBroadcasts(request) {
  const due = db.prepare(`
    SELECT * FROM broadcasts
    WHERE scheduled_at IS NOT NULL
      AND scheduled_at <= ?
      AND status IN ('agendado', 'fila_preparada')
    ORDER BY scheduled_at ASC
    LIMIT 20
  `).all(new Date().toISOString())

  const processed = []

  for (const row of due) {
    const broadcast = mapBroadcast(row)
    const result = await sendBroadcast(broadcast)
    const nextStatus = result.error || result.failed > 0 ? 'aguardando_integracao' : 'enviado'

    db.prepare('UPDATE broadcasts SET status = ?, sent_count = ?, failed_count = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(
      nextStatus,
      result.sent,
      result.failed,
      new Date().toISOString(),
      broadcast.id,
    )

    const updatedBroadcast = mapBroadcast(db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(broadcast.id))
    logAudit({
      request,
      user: null,
      action: 'broadcast_cron_sent',
      entity: 'broadcast',
      entityId: broadcast.id,
      summary: `Disparo agendado ${broadcast.channel} processado: ${result.sent} enviado(s), ${result.failed} falha(s).`,
      metadata: { channel: broadcast.channel, ...result },
    })

    processed.push({ broadcast: updatedBroadcast, ...result })
  }

  return processed
}

function mapUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
  }
}

function getUsers() {
  return db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY id DESC').all().map(mapUser)
}

function getRequestMeta(request) {
  return {
    ip: request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket?.remoteAddress || null,
    userAgent: request.headers['user-agent'] || null,
  }
}

function logAudit({ request, user, action, entity, entityId = null, summary, metadata = {} }) {
  const requestMeta = request ? getRequestMeta(request) : {}
  db.prepare(`
    INSERT INTO audit_logs (
      user_id, user_name, user_email, action, entity, entity_id, summary,
      metadata, ip_address, user_agent, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user?.id ?? null,
    user?.name ?? null,
    user?.email ?? null,
    action,
    entity,
    entityId ? String(entityId) : null,
    summary,
    JSON.stringify(metadata),
    requestMeta.ip,
    requestMeta.userAgent,
    new Date().toISOString(),
  )
}

function getAuditLogs(filters = {}) {
  const clauses = []
  const params = {}

  if (filters.action) {
    clauses.push('action = $action')
    params.action = filters.action
  }

  if (filters.userEmail) {
    clauses.push("lower(coalesce(user_email, '')) LIKE $userEmail")
    params.userEmail = `%${filters.userEmail.toLowerCase()}%`
  }

  if (filters.dateFrom) {
    clauses.push('created_at >= $dateFrom')
    params.dateFrom = filters.dateFrom
  }

  if (filters.dateTo) {
    clauses.push('created_at <= $dateTo')
    params.dateTo = filters.dateTo
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

  return db.prepare(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT 150`).all(params).map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id,
    summary: row.summary,
    metadata: JSON.parse(row.metadata || '{}'),
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  }))
}

function getSystemStatus() {
  const registration = db.prepare('SELECT * FROM system_registration WHERE id = 1').get()
  const lastAudit = db.prepare('SELECT created_at FROM audit_logs ORDER BY id DESC LIMIT 1').get()

  return {
    database: {
      ok: true,
      provider: 'SQLite local',
      checkedAt: new Date().toISOString(),
    },
    registration: {
      registered: Boolean(registration),
      registeredAt: registration?.registered_at ?? null,
      registeredByEmail: registration?.registered_by_email ?? null,
      fingerprint: registration?.key_fingerprint ?? null,
      keyConfigured: Boolean(process.env.SYSTEM_REGISTRATION_KEY),
    },
    counts: {
      conversations: db.prepare('SELECT COUNT(*) AS total FROM conversations').get().total,
      messages: db.prepare('SELECT COUNT(*) AS total FROM messages').get().total,
      templates: db.prepare('SELECT COUNT(*) AS total FROM templates').get().total,
      calculations: db.prepare('SELECT COUNT(*) AS total FROM calculations').get().total,
      broadcasts: db.prepare('SELECT COUNT(*) AS total FROM broadcasts').get().total,
      users: db.prepare('SELECT COUNT(*) AS total FROM users').get().total,
      auditLogs: db.prepare('SELECT COUNT(*) AS total FROM audit_logs').get().total,
    },
    lastAuditAt: lastAudit?.created_at ?? null,
  }
}

function getEmailSettings({ includeSecrets = false } = {}) {
  const row = db.prepare("SELECT value FROM system_settings WHERE key = 'email_accounts'").get()
  const parsed = row?.value ? JSON.parse(row.value) : { accounts: [] }
  const accounts = Array.isArray(parsed.accounts) ? parsed.accounts : []

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

function saveEmailSettings(accounts = [], user, request) {
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

  db.prepare(`
    INSERT INTO system_settings (key, value, updated_by, updated_by_email, updated_at)
    VALUES ('email_accounts', ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_by = excluded.updated_by,
      updated_by_email = excluded.updated_by_email,
      updated_at = excluded.updated_at
  `).run(JSON.stringify({ accounts: normalizedAccounts }), user.id, user.email, new Date().toISOString())

  logAudit({
    request,
    user,
    action: 'email_settings_updated',
    entity: 'system',
    summary: `Configuracao de e-mail atualizada com ${normalizedAccounts.length} conta(s).`,
    metadata: { accounts: normalizedAccounts.map((account) => ({ id: account.id, label: account.label, from: account.from })) },
  })

  return getEmailSettings()
}

function getCompanySettings() {
  const row = db.prepare("SELECT value FROM system_settings WHERE key = 'company_profile'").get()
  const profile = row?.value ? JSON.parse(row.value) : {}

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

function saveCompanySettings(profile = {}, user, request) {
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

  db.prepare(`
    INSERT INTO system_settings (key, value, updated_by, updated_by_email, updated_at)
    VALUES ('company_profile', ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_by = excluded.updated_by,
      updated_by_email = excluded.updated_by_email,
      updated_at = excluded.updated_at
  `).run(JSON.stringify(normalizedProfile), user.id, user.email, new Date().toISOString())

  logAudit({
    request,
    user,
    action: 'company_settings_updated',
    entity: 'system',
    summary: `Cadastro da empresa atualizado: ${normalizedProfile.tradeName || normalizedProfile.name || 'sem nome'}.`,
    metadata: {
      name: normalizedProfile.name,
      tradeName: normalizedProfile.tradeName,
      document: normalizedProfile.document,
      hasLogo: Boolean(normalizedProfile.logoDataUrl),
    },
  })

  return getCompanySettings()
}

function registerSystem(registrationKey, user, request) {
  const expectedKey = process.env.SYSTEM_REGISTRATION_KEY

  if (!expectedKey) {
    const error = new Error('Chave de registro nao configurada no ambiente.')
    error.status = 503
    throw error
  }

  if (!safeEqualText(String(registrationKey || '').trim(), expectedKey.trim())) {
    logAudit({
      request,
      user,
      action: 'system_registration_failed',
      entity: 'system',
      summary: 'Tentativa de registro do sistema recusada.',
    })

    const error = new Error('Chave de registro invalida.')
    error.status = 403
    throw error
  }

  const fingerprint = createHash('sha256').update(expectedKey).digest('hex').slice(0, 16).toUpperCase()
  db.prepare(`
    INSERT INTO system_registration (id, key_fingerprint, registered_by, registered_by_email, registered_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      key_fingerprint = excluded.key_fingerprint,
      registered_by = excluded.registered_by,
      registered_by_email = excluded.registered_by_email,
      registered_at = excluded.registered_at
  `).run(fingerprint, user.id, user.email, new Date().toISOString())

  logAudit({
    request,
    user,
    action: 'system_registered',
    entity: 'system',
    summary: 'Sistema registrado com chave valida.',
    metadata: { fingerprint },
  })

  return getSystemStatus()
}

function getConversation(id) {
  return getConversations().find((conversation) => conversation.id === id)
}

async function routeRequest(request, response) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`)

  if (request.method === 'OPTIONS') {
    return sendJson(response, 204, {})
  }

  try {
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(response, 200, { ok: true })
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await readBody(request)
      const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(body.email)

      if (!user || !verifyPassword(body.password, user.password_hash)) {
        logAudit({
          request,
          user: null,
          action: 'login_failed',
          entity: 'auth',
          summary: `Tentativa de login recusada para ${body.email || 'email vazio'}.`,
          metadata: { email: body.email },
        })
        return sendJson(response, 401, { error: 'Email ou senha invalidos.' })
      }

      logAudit({
        request,
        user,
        action: 'login_success',
        entity: 'auth',
        entityId: user.id,
        summary: `${user.name} entrou no sistema.`,
      })

      return sendJson(response, 200, { ...mapUser(user), token: createSessionToken(user) })
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/change-password') {
      const body = await readBody(request)
      const authUser = requireAuth(request)

      if (Number(authUser.id) !== Number(body.userId) && authUser.role !== 'admin') {
        return sendJson(response, 403, { error: 'Permissao insuficiente.' })
      }

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(body.userId)

      if (!user || !verifyPassword(body.currentPassword, user.password_hash)) {
        return sendJson(response, 401, { error: 'Senha atual invalida.' })
      }

      if (!body.newPassword || body.newPassword.length < 6) {
        return sendJson(response, 400, { error: 'A nova senha deve ter pelo menos 6 caracteres.' })
      }

      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.newPassword), body.userId)
      logAudit({
        request,
        user: authUser,
        action: 'password_changed',
        entity: 'user',
        entityId: body.userId,
        summary: `Senha alterada para ${user.name}.`,
        metadata: { targetEmail: user.email },
      })
      return sendJson(response, 200, { ok: true })
    }

    const systemAction = url.pathname === '/api/system' ? url.searchParams.get('action') || '' : ''

    if (request.method === 'GET' && (url.pathname === '/api/system/status' || systemAction === 'status')) {
      requireAuth(request, ['admin'])
      return sendJson(response, 200, getSystemStatus())
    }

    if (request.method === 'POST' && (url.pathname === '/api/system/register' || systemAction === 'register')) {
      const authUser = requireAuth(request, ['admin'])
      const body = await readBody(request)
      return sendJson(response, 200, registerSystem(body.registrationKey, authUser, request))
    }

    if (url.pathname === '/api/system/email-settings' || systemAction === 'email-settings') {
      const authUser = requireAuth(request, ['admin'])

      if (request.method === 'GET') {
        return sendJson(response, 200, getEmailSettings())
      }

      if (request.method === 'PUT') {
        const body = await readBody(request)
        const currentSettings = getEmailSettings({ includeSecrets: true })
        const currentById = new Map(currentSettings.accounts.map((account) => [account.id, account.pass]))
        const accounts = Array.isArray(body.accounts) ? body.accounts : []
        const mergedAccounts = accounts.map((account) => ({
          ...account,
          existingPass: account.pass ? '' : currentById.get(account.id) || '',
        }))

        return sendJson(response, 200, saveEmailSettings(mergedAccounts, authUser, request))
      }

      return sendJson(response, 405, { error: 'Metodo nao permitido.' })
    }

    if (url.pathname === '/api/system/company-settings' || systemAction === 'company-settings') {
      const authUser = requireAuth(request, ['admin'])

      if (request.method === 'GET') {
        return sendJson(response, 200, getCompanySettings())
      }

      if (request.method === 'PUT') {
        const body = await readBody(request)
        return sendJson(response, 200, saveCompanySettings(body || {}, authUser, request))
      }

      return sendJson(response, 405, { error: 'Metodo nao permitido.' })
    }

    if (request.method === 'GET' && url.pathname === '/api/audit-logs') {
      requireAuth(request, ['admin'])
      requireSystemRegistered()
      return sendJson(response, 200, getAuditLogs({
        action: url.searchParams.get('action') || '',
        userEmail: url.searchParams.get('userEmail') || '',
        dateFrom: url.searchParams.get('dateFrom') || '',
        dateTo: url.searchParams.get('dateTo') || '',
      }))
    }

    if (request.method === 'GET' && url.pathname === '/api/users') {
      requireAuth(request, ['admin'])
      requireSystemRegistered()
      return sendJson(response, 200, getUsers())
    }

    if (request.method === 'POST' && url.pathname === '/api/users') {
      const authUser = requireAuth(request, ['admin'])
      requireSystemRegistered()
      const body = await readBody(request)
      const result = db.prepare('INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(
        body.name,
        body.email,
        hashPassword(body.password),
        body.role || 'atendente',
        new Date().toISOString(),
      )
      const createdUser = mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid))
      logAudit({
        request,
        user: authUser,
        action: 'user_created',
        entity: 'user',
        entityId: createdUser.id,
        summary: `Usuario ${createdUser.name} criado com perfil ${createdUser.role}.`,
        metadata: { email: createdUser.email, role: createdUser.role },
      })
      return sendJson(response, 201, createdUser)
    }

    if (request.method === 'PUT' && url.pathname === '/api/users') {
      const authUser = requireAuth(request, ['admin'])
      requireSystemRegistered()
      const body = await readBody(request)

      if (body.password) {
        db.prepare('UPDATE users SET name = ?, email = ?, role = ?, password_hash = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?').run(
          body.name,
          body.email,
          body.role || 'atendente',
          hashPassword(body.password),
          new Date().toISOString(),
          authUser.id,
          body.id,
        )
      } else {
        db.prepare('UPDATE users SET name = ?, email = ?, role = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?').run(
          body.name,
          body.email,
          body.role || 'atendente',
          new Date().toISOString(),
          authUser.id,
          body.id,
        )
      }

      const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(body.id)

      if (!updatedUser) {
        return sendJson(response, 404, { error: 'Usuario nao encontrado.' })
      }

      const mappedUser = mapUser(updatedUser)
      logAudit({
        request,
        user: authUser,
        action: 'user_updated',
        entity: 'user',
        entityId: mappedUser.id,
        summary: `Usuario ${mappedUser.name} atualizado com perfil ${mappedUser.role}.`,
        metadata: { email: mappedUser.email, role: mappedUser.role, passwordChanged: Boolean(body.password) },
      })
      return sendJson(response, 200, mappedUser)
    }

    if (request.method === 'DELETE' && url.pathname === '/api/users') {
      const authUser = requireAuth(request, ['admin'])
      requireSystemRegistered()
      const id = Number(url.searchParams.get('id'))

      if (!id) {
        return sendJson(response, 400, { error: 'Informe o usuario para excluir.' })
      }

      if (Number(authUser.id) === id) {
        return sendJson(response, 400, { error: 'Nao e permitido excluir o proprio usuario logado.' })
      }

      const current = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(id)

      if (!current) {
        return sendJson(response, 404, { error: 'Usuario nao encontrado.' })
      }

      db.prepare('DELETE FROM users WHERE id = ?').run(id)
      logAudit({
        request,
        user: authUser,
        action: 'user_deleted',
        entity: 'user',
        entityId: id,
        summary: `Usuario ${current.name} excluido.`,
        metadata: { email: current.email, role: current.role },
      })
      return sendJson(response, 200, { ok: true })
    }

    if (request.method === 'GET' && url.pathname === '/api/conversations') {
      requireAuth(request)
      requireSystemRegistered()
      return sendJson(response, 200, getConversations())
    }

    if (request.method === 'POST' && url.pathname === '/api/conversations') {
      const authUser = requireAuth(request)
      requireSystemRegistered()
      const body = await readBody(request)
      const result = db
        .prepare(`
          INSERT INTO conversations (
            contact, company, phone, email, channel, subject, status, priority,
            responsible, last_update, created_at, scheduled_at, next_action
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          body.contact,
          body.company || body.contact,
          body.phone,
          body.email,
          body.channel,
          body.subject || 'Novo atendimento',
          body.status || 'novo',
          body.priority || 'normal',
          body.responsible || 'Sem responsavel',
          body.lastUpdate || body.createdAt,
          body.createdAt,
          body.scheduledAt || null,
          body.nextAction || 'Iniciar atendimento',
        )

      db.prepare('INSERT INTO messages (conversation_id, author, text, time) VALUES (?, ?, ?, ?)').run(
        result.lastInsertRowid,
        'client',
        'Contato cadastrado manualmente.',
        body.lastUpdate || body.createdAt,
      )

      const conversation = getConversation(Number(result.lastInsertRowid))
      logAudit({
        request,
        user: authUser,
        action: 'conversation_created',
        entity: 'conversation',
        entityId: conversation.id,
        summary: `Contato ${conversation.contact} cadastrado pelo canal ${conversation.channel}.`,
        metadata: { email: conversation.email, phone: conversation.phone, scheduledAt: conversation.scheduledAt },
      })
      return sendJson(response, 201, conversation)
    }

    const conversationPatch = url.pathname.match(/^\/api\/conversations\/(\d+)$/)

    if (request.method === 'PATCH' && conversationPatch) {
      const authUser = requireAuth(request)
      requireSystemRegistered()
      const id = Number(conversationPatch[1])
      const body = await readBody(request)
      const current = getConversation(id)

      if (!current) {
        return sendJson(response, 404, { error: 'Atendimento nao encontrado.' })
      }

      db.prepare(`
        UPDATE conversations
        SET status = ?, last_update = ?, scheduled_at = ?, next_action = ?,
            updated_at = ?, updated_by = ?, version = version + 1
        WHERE id = ?
      `).run(
        body.status ?? current.status,
        body.lastUpdate ?? current.lastUpdate,
        body.scheduledAt ?? current.scheduledAt ?? null,
        body.nextAction ?? current.nextAction,
        new Date().toISOString(),
        authUser.id,
        id,
      )

      const updated = getConversation(id)
      logAudit({
        request,
        user: authUser,
        action: 'conversation_updated',
        entity: 'conversation',
        entityId: id,
        summary: `Atendimento de ${updated.contact} atualizado para ${updated.status}.`,
        metadata: { status: updated.status, scheduledAt: updated.scheduledAt, nextAction: updated.nextAction },
      })
      return sendJson(response, 200, updated)
    }

    if (request.method === 'DELETE' && conversationPatch) {
      const authUser = requireAuth(request)
      requireSystemRegistered()
      const id = Number(conversationPatch[1])
      const current = getConversation(id)

      if (!current) {
        return sendJson(response, 404, { error: 'Atendimento nao encontrado.' })
      }

      db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
      logAudit({
        request,
        user: authUser,
        action: 'conversation_deleted',
        entity: 'conversation',
        entityId: id,
        summary: `Atendimento de ${current.contact} excluido.`,
        metadata: { email: current.email, phone: current.phone, channel: current.channel },
      })
      return sendJson(response, 200, { ok: true })
    }

    const messagePost = url.pathname.match(/^\/api\/conversations\/(\d+)\/messages$/)

    if (request.method === 'POST' && messagePost) {
      const authUser = requireAuth(request)
      requireSystemRegistered()
      const id = Number(messagePost[1])
      const body = await readBody(request)

      db.prepare('INSERT INTO messages (conversation_id, author, text, time) VALUES (?, ?, ?, ?)').run(
        id,
        body.author || 'agent',
        body.text,
        body.time,
      )
      db.prepare('UPDATE conversations SET status = ?, last_update = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?').run(
        'em_atendimento',
        body.time,
        new Date().toISOString(),
        authUser.id,
        id,
      )

      const conversation = getConversation(id)
      logAudit({
        request,
        user: authUser,
        action: 'message_sent',
        entity: 'conversation',
        entityId: id,
        summary: `Mensagem registrada no atendimento de ${conversation.contact}.`,
        metadata: { author: body.author || 'agent' },
      })
      return sendJson(response, 201, conversation)
    }

    if (request.method === 'GET' && url.pathname === '/api/templates') {
      requireAuth(request)
      requireSystemRegistered()
      return sendJson(response, 200, getTemplates())
    }

    if (request.method === 'POST' && url.pathname === '/api/templates') {
      const authUser = requireAuth(request)
      requireSystemRegistered()
      const body = await readBody(request)
      const result = db.prepare('INSERT INTO templates (title, body) VALUES (?, ?)').run(body.title, body.body)
      logAudit({
        request,
        user: authUser,
        action: 'template_created',
        entity: 'template',
        entityId: result.lastInsertRowid,
        summary: `Modelo de resposta "${body.title}" criado.`,
      })
      return sendJson(response, 201, { id: Number(result.lastInsertRowid), title: body.title, body: body.body })
    }

    if (request.method === 'DELETE' && url.pathname === '/api/templates') {
      const authUser = requireAuth(request)
      requireSystemRegistered()
      const id = Number(url.searchParams.get('id'))

      if (!id) {
        return sendJson(response, 400, { error: 'Informe o modelo para excluir.' })
      }

      const current = db.prepare('SELECT id, title FROM templates WHERE id = ?').get(id)

      if (!current) {
        return sendJson(response, 404, { error: 'Modelo nao encontrado.' })
      }

      db.prepare('DELETE FROM templates WHERE id = ?').run(id)
      logAudit({
        request,
        user: authUser,
        action: 'template_deleted',
        entity: 'template',
        entityId: id,
        summary: `Modelo de resposta "${current.title}" excluido.`,
      })
      return sendJson(response, 200, { ok: true })
    }

    if (request.method === 'GET' && url.pathname === '/api/calculations') {
      requireAuth(request)
      requireSystemRegistered()
      return sendJson(response, 200, getCalculations())
    }

    if (request.method === 'POST' && url.pathname === '/api/calculations') {
      const authUser = requireAuth(request)
      requireSystemRegistered()
      const body = await readBody(request)
      const result = db
        .prepare(`
          INSERT INTO calculations (
            kind, formula, client_name, reference, description, principal, correction,
            interest, fees, estimated_total, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          body.kind,
          body.formula || 'livre',
          body.clientName,
          body.reference,
          body.description,
          body.principal,
          body.correction,
          body.interest,
          body.fees,
          body.estimatedTotal,
          body.status,
          body.createdAt,
        )
      const calculation = mapCalculation(db.prepare('SELECT * FROM calculations WHERE id = ?').get(result.lastInsertRowid))
      logAudit({
        request,
        user: authUser,
        action: 'calculation_created',
        entity: 'calculation',
        entityId: calculation.id,
        summary: `Calculo ${calculation.kind} criado para ${calculation.clientName}.`,
        metadata: {
          kind: calculation.kind,
          formula: calculation.formula,
          reference: calculation.reference,
          estimatedTotal: calculation.estimatedTotal,
        },
      })
      return sendJson(response, 201, calculation)
    }

    if (request.method === 'DELETE' && url.pathname === '/api/calculations') {
      const authUser = requireAuth(request)
      requireSystemRegistered()
      const id = Number(url.searchParams.get('id'))

      if (!id) {
        return sendJson(response, 400, { error: 'Informe o calculo para excluir.' })
      }

      const current = db.prepare('SELECT id, kind, client_name, reference FROM calculations WHERE id = ?').get(id)

      if (!current) {
        return sendJson(response, 404, { error: 'Calculo nao encontrado.' })
      }

      db.prepare('DELETE FROM calculations WHERE id = ?').run(id)
      logAudit({
        request,
        user: authUser,
        action: 'calculation_deleted',
        entity: 'calculation',
        entityId: id,
        summary: `Calculo ${current.kind} de ${current.client_name} excluido.`,
        metadata: { reference: current.reference },
      })
      return sendJson(response, 200, { ok: true })
    }

    if (request.method === 'GET' && url.pathname === '/api/broadcasts' && url.searchParams.get('cron') === 'send-scheduled') {
      requireSystemRegistered()
      const expectedSecret = process.env.CRON_SECRET
      const authorization = request.headers.authorization || ''

      if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
        return sendJson(response, 401, { error: 'Cron nao autorizado.' })
      }

      const processed = await processScheduledBroadcasts(request)
      return sendJson(response, 200, { ok: true, processed: processed.length })
    }

    if (request.method === 'GET' && url.pathname === '/api/broadcasts') {
      requireAuth(request, ['admin', 'atendente', 'sdr'])
      requireSystemRegistered()
      if (url.searchParams.get('integrations')) {
        return sendJson(response, 200, getIntegrationStatus())
      }
      return sendJson(response, 200, getBroadcasts())
    }

    if (request.method === 'POST' && url.pathname === '/api/broadcasts') {
      const authUser = requireAuth(request, ['admin', 'atendente', 'sdr'])
      requireSystemRegistered()
      const body = await readBody(request)
      const recipientCount = countRecipients(body.recipients)
      const result = db
        .prepare(`
          INSERT INTO broadcasts (
            channel, name, subject, sender_account, whatsapp_template_name, whatsapp_template_language, message, recipients, recipient_count, status,
            scheduled_at, created_by, created_by_email, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          body.channel,
          body.name,
          body.subject || null,
          body.senderAccount || null,
          body.whatsappTemplateName || null,
          body.whatsappTemplateLanguage || null,
          body.message,
          body.recipients,
          recipientCount,
          body.status || 'fila_preparada',
          body.scheduledAt || null,
          authUser.id,
          authUser.email,
          new Date().toISOString(),
        )
      const broadcast = mapBroadcast(db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(result.lastInsertRowid))
      logAudit({
        request,
        user: authUser,
        action: 'broadcast_created',
        entity: 'broadcast',
        entityId: broadcast.id,
        summary: `Disparo ${broadcast.channel} preparado com ${broadcast.recipientCount} destinatarios.`,
        metadata: { channel: broadcast.channel, scheduledAt: broadcast.scheduledAt },
      })
      return sendJson(response, 201, broadcast)
    }

    if (request.method === 'PATCH' && url.pathname === '/api/broadcasts') {
      const authUser = requireAuth(request, ['admin', 'atendente', 'sdr'])
      requireSystemRegistered()
      const body = await readBody(request)

      if (body.action !== 'send') {
        return sendJson(response, 400, { error: 'Acao invalida.' })
      }

      const current = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(body.id)

      if (!current) {
        return sendJson(response, 404, { error: 'Disparo nao encontrado.' })
      }

      const broadcast = mapBroadcast(current)
      const result = await sendBroadcast(broadcast)
      const nextStatus = result.error || result.failed > 0 ? 'aguardando_integracao' : 'enviado'
      db.prepare('UPDATE broadcasts SET status = ?, sent_count = ?, failed_count = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?').run(
        nextStatus,
        result.sent,
        result.failed,
        new Date().toISOString(),
        authUser.id,
        broadcast.id,
      )
      const updatedBroadcast = mapBroadcast(db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(broadcast.id))
      logAudit({
        request,
        user: authUser,
        action: 'broadcast_sent',
        entity: 'broadcast',
        entityId: broadcast.id,
        summary: `Disparo ${broadcast.channel} processado: ${result.sent} enviado(s), ${result.failed} falha(s).`,
        metadata: { channel: broadcast.channel, ...result },
      })
      return sendJson(response, 200, { broadcast: updatedBroadcast, ...result })
    }

    if (request.method === 'DELETE' && url.pathname === '/api/broadcasts') {
      const authUser = requireAuth(request, ['admin', 'atendente', 'sdr'])
      requireSystemRegistered()
      const id = Number(url.searchParams.get('id'))

      if (!id) {
        return sendJson(response, 400, { error: 'Informe o disparo para excluir.' })
      }

      const current = db.prepare('SELECT id, channel, name, recipient_count FROM broadcasts WHERE id = ?').get(id)

      if (!current) {
        return sendJson(response, 404, { error: 'Disparo nao encontrado.' })
      }

      db.prepare('DELETE FROM broadcasts WHERE id = ?').run(id)
      logAudit({
        request,
        user: authUser,
        action: 'broadcast_deleted',
        entity: 'broadcast',
        entityId: id,
        summary: `Disparo ${current.name} excluido.`,
        metadata: { channel: current.channel, recipientCount: current.recipient_count },
      })
      return sendJson(response, 200, { ok: true })
    }

    return sendJson(response, 404, { error: 'Rota nao encontrada.' })
  } catch (error) {
    return sendJson(response, error.status || 500, { error: error instanceof Error ? error.message : 'Erro interno.' })
  }
}

createServer(routeRequest).listen(port, '127.0.0.1', () => {
  console.log(`Controle 360 API running at http://127.0.0.1:${port}`)
})
