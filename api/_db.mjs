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
    body: 'Para continuar, preciso do seu consentimento para tratar seus dados pessoais apenas para fins de atendimento, triagem, organizacao de documentos e agendamento. Voce autoriza