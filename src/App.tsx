import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import {
  CalendarClock,
  Calculator,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  History,
  Inbox,
  KeyRound,
  LogOut,
  Mail,
  MessageCircle,
  PanelRightOpen,
  Plus,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react'
import './App.css'
import { deleteOfflineSyncRecord, listOfflineSyncRecords, putOfflineSyncRecord } from './offlineDb'

type Channel = 'whatsapp' | 'email'
type Status = 'novo' | 'em_atendimento' | 'aguardando_cliente' | 'retorno' | 'concluido'
type Priority = 'baixa' | 'normal' | 'alta'
type View = 'inbox' | 'contatos' | 'modelos' | 'disparos' | 'documentos' | 'calculos' | 'usuarios' | 'seguranca' | 'auditoria' | 'sincronizacao' | 'conta' | 'relatorios'
type ReportKind = 'completo' | 'atendimentos' | 'agenda' | 'calculos' | 'disparos' | 'seguranca'

type Message = {
  id: number
  author: 'client' | 'agent'
  text: string
  time: string
}

type Conversation = {
  id: number
  contact: string
  company: string
  phone: string
  email: string
  channel: Channel
  subject: string
  status: Status
  priority: Priority
  responsible: string
  lastUpdate: string
  createdAt?: string
  scheduledAt?: string
  nextAction: string
  messages: Message[]
}

type Template = {
  id: number
  title: string
  body: string
}

type Session = {
  id?: number
  name: string
  email: string
  role?: string
  token?: string
}

type User = {
  id: number
  name: string
  email: string
  role: string
  createdAt: string
}

type AuditLog = {
  id: number
  userId: number | null
  userName: string | null
  userEmail: string | null
  action: string
  entity: string
  entityId: string | null
  summary: string
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
}

type SystemStatus = {
  database: {
    ok: boolean
    provider: string
    checkedAt: string
  }
  registration: {
    registered: boolean
    registeredAt: string | null
    registeredByEmail: string | null
    fingerprint: string | null
    keyConfigured: boolean
  }
  counts: {
    conversations: number
    messages: number
    templates: number
    calculations: number
    broadcasts?: number
    users: number
    auditLogs: number
  }
  lastAuditAt: string | null
}

type Broadcast = {
  id: number
  channel: Channel
  name: string
  subject?: string | null
  senderAccount?: string | null
  whatsappTemplateName?: string | null
  whatsappTemplateLanguage?: string | null
  message: string
  recipients: string
  recipientCount: number
  sentCount?: number
  failedCount?: number
  status: 'fila_preparada' | 'agendado' | 'aguardando_integracao' | 'enviado'
  scheduledAt?: string | null
  createdByEmail?: string | null
  createdAt: string
}

type IntegrationStatus = {
  whatsapp: boolean
  email: boolean
  whatsappVersion: string | null
  emailFrom: string | null
  emailAccounts?: Array<{
    id: string
    label: string
    from: string
  }>
}

type EmailAccountSetting = {
  id: string
  label: string
  host: string
  port: number
  secure: boolean
  user: string
  from: string
  pass?: string
  hasPassword?: boolean
}

type EmailSettings = {
  accounts: EmailAccountSetting[]
}

type CompanySettings = {
  name: string
  tradeName: string
  document: string
  stateRegistration: string
  municipalRegistration: string
  responsible: string
  phone: string
  whatsapp: string
  email: string
  website: string
  address: string
  city: string
  state: string
  zipCode: string
  logoDataUrl: string
}

type LetterheadForm = {
  title: string
  recipient: string
  recipientEmail: string
  reference: string
  body: string
  signer: string
  signerRole: string
}

type SavedLetterheadDocument = LetterheadForm & {
  id: number
  createdAt: string
  createdByEmail?: string
}

type PendingSyncItem = {
  id: string
  userKey: string
  path: string
  method: string
  body?: string
  createdAt: string
  attempts: number
  lastError?: string
}

type CalculationKind = 'judicial' | 'previdenciario'
type CalculationFormula = 'livre' | 'trabalhista' | 'previdenciario_atrasados'

type Calculation = {
  id: number
  kind: CalculationKind
  formula?: CalculationFormula
  clientName: string
  reference: string
  description: string
  principal: number
  correction: number
  interest: number
  fees: number
  estimatedTotal: number
  status: 'rascunho' | 'em_revisao' | 'aprovado' | 'enviado'
  createdAt: string
}

const storageKeys = {
  conversations: 'controle360.conversations',
  templates: 'controle360.templates',
  calculations: 'controle360.calculations',
  broadcasts: 'controle360.broadcasts',
  letterheadDraft: 'controle360.letterheadDraft',
  letterheadDocuments: 'controle360.letterheadDocuments',
  session: 'controle360.session',
  auditLogs: 'controle360.auditLogs',
  syncQueue: 'controle360.syncQueue',
}

const configuredApiBaseUrl = import.meta.env.VITE_API_URL?.trim()
const shouldUseApi = Boolean(configuredApiBaseUrl) || import.meta.env.PROD
const apiBaseUrl = configuredApiBaseUrl ?? ''

const initialConversations: Conversation[] = [
  {
    id: 1,
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
      { id: 1, author: 'client', text: 'Bom dia, vi o servico de voces e queria entender os planos.', time: '09:21' },
      { id: 2, author: 'agent', text: 'Bom dia, Mariana. Temos planos mensais e anuais. Posso te mandar a proposta resumida?', time: '09:29' },
      { id: 3, author: 'client', text: 'Pode sim. Tambem quero confirmar os valores e formas de pagamento.', time: '09:42' },
    ],
  },
  {
    id: 2,
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
      { id: 1, author: 'client', text: 'Enviei os documentos solicitados para avaliacao.', time: '08:15' },
      { id: 2, author: 'agent', text: 'Recebido, Roberto. Vou revisar e te devolver com o contrato atualizado.', time: '08:31' },
    ],
  },
  {
    id: 3,
    contact: 'Clinica Vida',
    company: 'Clinica Vida',
    phone: '+55 71 96666-9000',
    email: 'atendimento@clinicavida.com',
    channel: 'whatsapp',
    subject: 'Suporte sobre agendamento',
    status: 'aguardando_cliente',
    priority: 'normal',
    responsible: 'Ana Paula',
    lastUpdate: 'Ontem',
    createdAt: '2026-05-29T15:10',
    scheduledAt: '2026-05-31T09:00',
    nextAction: 'Aguardar confirmacao do novo horario',
    messages: [
      { id: 1, author: 'client', text: 'Precisamos alterar o horario de atendimento.', time: 'Ontem' },
      { id: 2, author: 'agent', text: 'Sem problema. Posso confirmar a agenda para quinta as 15h?', time: 'Ontem' },
    ],
  },
  {
    id: 4,
    contact: 'Financeiro Alves',
    company: 'Grupo Alves',
    phone: '+55 71 95555-0303',
    email: 'financeiro@grupoalves.com',
    channel: 'email',
    subject: 'Boleto e nota fiscal',
    status: 'novo',
    priority: 'baixa',
    responsible: 'Sem responsavel',
    lastUpdate: 'Sexta',
    createdAt: '2026-05-29T10:05',
    nextAction: 'Atribuir atendimento',
    messages: [
      { id: 1, author: 'client', text: 'Poderiam reenviar a nota fiscal do mes?', time: 'Sexta' },
    ],
  },
]

const initialTemplates: Template[] = [
  {
    id: 1,
    title: 'Boas-vindas',
    body: 'Ola! Obrigado pelo contato. Ja recebemos sua mensagem e vamos te atender em instantes.',
  },
  {
    id: 2,
    title: 'Enviar proposta',
    body: 'Segue a proposta conforme conversamos. Fico a disposicao para ajustar qualquer ponto.',
  },
  {
    id: 3,
    title: 'Aguardando retorno',
    body: 'Passando para confirmar se conseguiu avaliar as informacoes. Posso te ajudar com mais alguma duvida?',
  },
  {
    id: 4,
    title: 'Consentimento LGPD',
    body: 'Para continuar, preciso do seu consentimento para tratar seus dados pessoais apenas para fins de atendimento, triagem, organizacao de documentos e agendamento. Voce autoriza?',
  },
  {
    id: 5,
    title: 'Triagem previdenciaria',
    body: 'Qual beneficio voce busca: aposentadoria, auxilio por incapacidade, BPC/LOAS, pensao por morte, salario-maternidade ou revisao de beneficio?',
  },
  {
    id: 6,
    title: 'Orcamento de calculos',
    body: 'Para preparar o orcamento, me envie o tipo de calculo, numero do processo, vara, prazo desejado e se ja existe sentenca ou decisao para liquidacao.',
  },
]

const initialCalculations: Calculation[] = [
  {
    id: 1,
    kind: 'judicial',
    formula: 'trabalhista',
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
    id: 2,
    kind: 'previdenciario',
    formula: 'previdenciario_atrasados',
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

const statusLabel: Record<Status, string> = {
  novo: 'Novo',
  em_atendimento: 'Em atendimento',
  aguardando_cliente: 'Aguardando cliente',
  retorno: 'Retorno',
  concluido: 'Concluido',
}

const priorityLabel: Record<Priority, string> = {
  baixa: 'Baixa',
  normal: 'Normal',
  alta: 'Alta',
}

const calculationKindLabel: Record<CalculationKind, string> = {
  judicial: 'Judicial',
  previdenciario: 'Previdenciario',
}

const calculationFormulaLabel: Record<CalculationFormula, string> = {
  livre: 'Livre / revisao manual',
  trabalhista: 'Trabalhista assistido',
  previdenciario_atrasados: 'Previdenciario - atrasados',
}

const broadcastStatusLabel: Record<Broadcast['status'], string> = {
  fila_preparada: 'Fila preparada',
  agendado: 'Agendado',
  aguardando_integracao: 'Aguardando integracao',
  enviado: 'Enviado a API',
}

const messageTextTemplates = [
  { label: 'Boas-vindas', path: '/modelos-mensagens/boas-vindas.txt' },
  { label: 'Pedido de documentos', path: '/modelos-mensagens/documentos.txt' },
  { label: 'Retorno de atendimento', path: '/modelos-mensagens/retorno.txt' },
]

const settingsViews: View[] = ['usuarios', 'seguranca', 'auditoria', 'sincronizacao', 'conta']

const defaultCompanySettings: CompanySettings = {
  name: 'JusPrevConecta',
  tradeName: 'JusPrevConecta',
  document: '',
  stateRegistration: '',
  municipalRegistration: '',
  responsible: '',
  phone: '',
  whatsapp: '',
  email: '',
  website: '',
  address: '',
  city: '',
  state: '',
  zipCode: '',
  logoDataUrl: '',
}

function createEmptyLetterheadForm(signer = 'JusPrevConecta'): LetterheadForm {
  return {
    title: '',
    recipient: '',
    recipientEmail: '',
    reference: '',
    body: '',
    signer,
    signerRole: 'Responsavel',
  }
}

const viewPermissions: Record<View, string[]> = {
  inbox: ['admin', 'atendente', 'advogado', 'calculista', 'sdr', 'local'],
  contatos: ['admin', 'atendente', 'advogado', 'sdr', 'local'],
  modelos: ['admin', 'atendente', 'sdr', 'local'],
  disparos: ['admin', 'atendente', 'sdr', 'local'],
  documentos: ['admin', 'advogado', 'calculista', 'sdr', 'local'],
  calculos: ['admin', 'advogado', 'calculista', 'local'],
  usuarios: ['admin', 'local'],
  seguranca: ['admin', 'local'],
  auditoria: ['admin', 'local'],
  sincronizacao: ['admin', 'atendente', 'advogado', 'calculista', 'sdr', 'local'],
  conta: ['admin', 'atendente', 'advogado', 'calculista', 'sdr', 'local'],
  relatorios: ['admin', 'advogado', 'calculista', 'sdr', 'local'],
}

function canAccess(view: View, session: Session | null) {
  return viewPermissions[view].includes(session?.role ?? 'local')
}

function redactSensitiveText(value?: string | null) {
  if (!value) {
    return ''
  }

  return value
    .replace(/Bearer\s+['"]?[^'"\s\\]+/gi, 'Bearer [oculto]')
    .replace(/Authorization:\s*Bearer\s+[^'"\s\\]+/gi, 'Authorization: Bearer [oculto]')
    .replace(/(access_token=)[^&\s]+/gi, '$1[oculto]')
    .replace(/(WHATSAPP_ACCESS_TOKEN=)[^\s]+/gi, '$1[oculto]')
    .replace(/\b(EAA[A-Za-z0-9_-]{20,}|EAAG[A-Za-z0-9_-]{20,}|[A-Fa-f0-9]{32,})\b/g, '[token oculto]')
}

function isTechnicalWhatsAppPayload(value?: string | null) {
  if (!value) {
    return false
  }

  return /curl\s+-i\s+-X\s+POST|graph\.facebook\.com|Authorization:\s*Bearer|messaging_product/i.test(value)
}

function loadStoredValue<T>(key: string, fallback: T): T {
  const stored = localStorage.getItem(key)

  if (!stored) {
    return fallback
  }

  try {
    return JSON.parse(stored) as T
  } catch {
    return fallback
  }
}

function loadSession() {
  localStorage.removeItem(storageKeys.session)
  return loadStoredValueFrom(sessionStorage, storageKeys.session, null as Session | null)
}

function loadStoredValueFrom<T>(storage: Storage, key: string, fallback: T): T {
  const stored = storage.getItem(key)

  if (!stored) {
    return fallback
  }

  try {
    return JSON.parse(stored) as T
  } catch {
    return fallback
  }
}

function getCurrentUserKey() {
  const storedSession = loadStoredValueFrom<Session | null>(sessionStorage, storageKeys.session, null)
  return storedSession?.email?.toLowerCase() ?? 'local'
}

function getUserScopedSyncKey(userKey = getCurrentUserKey()) {
  return `${storageKeys.syncQueue}.${userKey}`
}

function toDateTimeInputValue(date = new Date()) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return offsetDate.toISOString().slice(0, 16)
}

function formatDateTime(value?: string) {
  if (!value) {
    return 'Sem data definida'
  }

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatDate(value?: string) {
  if (!value) {
    return 'Sem data'
  }

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
  }).format(new Date(value))
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function isToday(value?: string) {
  if (!value) {
    return false
  }

  const date = new Date(value)
  const today = new Date()

  return date.toDateString() === today.toDateString()
}

function isFutureDate(value?: string) {
  if (!value) {
    return false
  }

  const scheduled = new Date(value)
  const today = new Date()
  scheduled.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)

  return scheduled > today
}

function isPastDate(value?: string) {
  if (!value) {
    return false
  }

  const scheduled = new Date(value)
  const today = new Date()
  scheduled.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)

  return scheduled < today
}

function percent(value: number, total: number) {
  if (!total) {
    return 0
  }

  return Math.round((value / total) * 100)
}

function getSessionExpiresAt(session: Session | null) {
  if (!session?.token?.includes('.')) {
    return null
  }

  try {
    const encodedPayload = session.token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(encodedPayload.padEnd(Math.ceil(encodedPayload.length / 4) * 4, '='))) as { exp?: number }
    return payload.exp ?? null
  } catch {
    return null
  }
}

function formatSessionRemaining(expiresAt: number | null) {
  if (!expiresAt) {
    return 'Sessao local'
  }

  const remainingMs = expiresAt - Date.now()

  if (remainingMs <= 0) {
    return 'Sessao expirada'
  }

  const hours = Math.floor(remainingMs / 3600000)
  const minutes = Math.max(0, Math.floor((remainingMs % 3600000) / 60000))

  if (hours > 0) {
    return `${hours}h ${minutes}min restantes`
  }

  return `${minutes}min restantes`
}

function buildAuditLogPath(filters: { action: string; userEmail: string; dateFrom: string; dateTo: string }) {
  const params = new URLSearchParams()

  if (filters.action) {
    params.set('action', filters.action)
  }

  if (filters.userEmail.trim()) {
    params.set('userEmail', filters.userEmail.trim())
  }

  if (filters.dateFrom) {
    params.set('dateFrom', new Date(filters.dateFrom).toISOString())
  }

  if (filters.dateTo) {
    const dateTo = new Date(filters.dateTo)
    dateTo.setHours(23, 59, 59, 999)
    params.set('dateTo', dateTo.toISOString())
  }

  const query = params.toString()
  return `/api/audit-logs${query ? `?${query}` : ''}`
}

function getPendingSyncQueue() {
  return loadStoredValue<PendingSyncItem[]>(getUserScopedSyncKey(), [])
}

function savePendingSyncQueue(queue: PendingSyncItem[]) {
  localStorage.setItem(getUserScopedSyncKey(), JSON.stringify(queue))
}

function shouldQueueOfflineRequest(path: string, method: string) {
  if (method === 'GET') {
    return false
  }

  return [
    '/api/conversations',
    '/api/templates',
    '/api/calculations',
    '/api/broadcasts',
    '/api/users',
  ].some((prefix) => path.startsWith(prefix))
}

function enqueueOfflineRequest(path: string, init?: RequestInit) {
  const method = init?.method?.toUpperCase() ?? 'GET'

  if (!shouldQueueOfflineRequest(path, method)) {
    return
  }

  const body = typeof init?.body === 'string' ? init.body : undefined
  const userKey = getCurrentUserKey()
  const queue = getPendingSyncQueue()
  const exists = queue.some((item) => item.path === path && item.method === method && item.body === body)

  if (exists) {
    return
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const createdAt = new Date().toISOString()

  savePendingSyncQueue([
    ...queue,
    {
      id,
      userKey,
      path,
      method,
      body,
      createdAt,
      attempts: 0,
    },
  ])
  void putOfflineSyncRecord({
    id,
    userKey,
    path,
    method,
    body,
    createdAt,
    attempts: 0,
  })
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (!shouldUseApi) {
    return null
  }

  const method = (init?.method || 'GET').toUpperCase()

  try {
    const storedSession = loadStoredValueFrom<Session | null>(sessionStorage, storageKeys.session, null)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (storedSession?.token) {
      headers.Authorization = `Bearer ${storedSession.token}`
    }

    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')

      if ([401, 403, 423].includes(response.status) || method === 'GET') {
        console.warn('API recusou a requisicao.', response.status, errorText)
        return null
      }

      throw new Error(`API respondeu com status ${response.status}`)
    }

    return (await response.json()) as T
  } catch (error) {
    console.warn('Usando armazenamento local porque a API nao respondeu.', error)
    if (method !== 'GET') {
      enqueueOfflineRequest(path, init)
    }
    return null
  }
}

function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession())
  const [loginEmail, setLoginEmail] = useState('admin@jusprevconecta.com')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [activeView, setActiveView] = useState<View>('inbox')
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    loadStoredValue(storageKeys.conversations, initialConversations),
  )
  const [templates, setTemplates] = useState<Template[]>(() => loadStoredValue(storageKeys.templates, initialTemplates))
  const [calculations, setCalculations] = useState<Calculation[]>(() =>
    loadStoredValue(storageKeys.calculations, initialCalculations),
  )
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>(() => loadStoredValue(storageKeys.broadcasts, []))
  const [users, setUsers] = useState<User[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => loadStoredValue(storageKeys.auditLogs, []))
  const [auditFilters, setAuditFilters] = useState({
    action: '',
    userEmail: '',
    dateFrom: '',
    dateTo: '',
  })
  const [reportKind, setReportKind] = useState<ReportKind>('completo')
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null)
  const [registrationKey, setRegistrationKey] = useState('')
  const [securityMessage, setSecurityMessage] = useState('')
  const [apiStatus, setApiStatus] = useState<'local' | 'online'>('local')
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [syncQueueCount, setSyncQueueCount] = useState(() => getPendingSyncQueue().length)
  const [pendingSyncItems, setPendingSyncItems] = useState<PendingSyncItem[]>(() => getPendingSyncQueue())
  const [syncMessage, setSyncMessage] = useState('')
  const [syncVersion, setSyncVersion] = useState(0)
  const [currentNow, setCurrentNow] = useState(() => new Date())
  const [selectedId, setSelectedId] = useState(conversations[0]?.id ?? 1)
  const [channelFilter, setChannelFilter] = useState<'todos' | Channel>('todos')
  const [statusFilter, setStatusFilter] = useState<'todos' | Status>('todos')
  const [searchTerm, setSearchTerm] = useState('')
  const [draft, setDraft] = useState('')
  const [returnDateTime, setReturnDateTime] = useState(toDateTimeInputValue())
  const [contactForm, setContactForm] = useState({
    contact: '',
    company: '',
    phone: '',
    email: '',
    channel: 'whatsapp' as Channel,
    subject: '',
    scheduledAt: '',
  })
  const [templateForm, setTemplateForm] = useState({ title: '', body: '' })
  const [calculationForm, setCalculationForm] = useState({
    kind: 'judicial' as CalculationKind,
    formula: 'livre' as CalculationFormula,
    clientName: '',
    reference: '',
    description: '',
    principal: '',
    correction: '',
    interest: '',
    fees: '',
  })
  const [broadcastForm, setBroadcastForm] = useState({
    channel: 'whatsapp' as Channel,
    name: '',
    subject: '',
    senderAccount: '',
    whatsappTemplateName: '',
    whatsappTemplateLanguage: 'en_US',
    message: '',
    recipients: '',
    scheduledAt: '',
  })
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(null)
  const [broadcastMessage, setBroadcastMessage] = useState('')
  const [emailSettings, setEmailSettings] = useState<EmailSettings>({ accounts: [] })
  const [emailSettingsMessage, setEmailSettingsMessage] = useState('')
  const [companySettings, setCompanySettings] = useState<CompanySettings>(() => ({ ...defaultCompanySettings }))
  const [companySettingsMessage, setCompanySettingsMessage] = useState('')
  const [emailAccountForm, setEmailAccountForm] = useState<EmailAccountSetting>({
    id: 'atendimento',
    label: 'Atendimento',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    user: '',
    from: '',
    pass: '',
  })
  const [userForm, setUserForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'atendente',
  })
  const [editingUserId, setEditingUserId] = useState<number | null>(null)
  const [userMessage, setUserMessage] = useState('')
  const [letterheadForm, setLetterheadForm] = useState<LetterheadForm>(() =>
    loadStoredValue(storageKeys.letterheadDraft, createEmptyLetterheadForm(session?.name ?? 'JusPrevConecta')),
  )
  const [documentMessage, setDocumentMessage] = useState('')
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [accountMessage, setAccountMessage] = useState('')
  const sessionExpiresAt = getSessionExpiresAt(session)
  const sessionRemaining = formatSessionRemaining(sessionExpiresAt)
  const companyLogo = companySettings.logoDataUrl || '/logo-cropped.png'
  const companyName = companySettings.tradeName || companySettings.name || 'JusPrevConecta'
  const companyLegalLine =
    companySettings.name && companySettings.name !== companyName
      ? companySettings.name
      : 'Solucoes juridicas e previdenciarias'
  const companyContactLine = [companySettings.document, companySettings.phone, companySettings.email].filter(Boolean).join(' | ')
  const companyAddressLine = [
    companySettings.address,
    companySettings.city,
    companySettings.state,
    companySettings.zipCode,
  ].filter(Boolean).join(' - ')
  const companyFooterLine = [
    companyName,
    companySettings.document,
    companyAddressLine,
    companySettings.phone,
    companySettings.whatsapp ? `WhatsApp ${companySettings.whatsapp}` : '',
    companySettings.email,
    companySettings.website,
  ].filter(Boolean).join(' | ')
  const registrationRequired = Boolean(session?.token && systemStatus && !systemStatus.registration.registered)

  function refreshSyncQueueCount() {
    const queue = getPendingSyncQueue()
    setPendingSyncItems(queue)
    setSyncQueueCount(queue.length)
  }

  useEffect(() => {
    localStorage.setItem(storageKeys.conversations, JSON.stringify(conversations))
  }, [conversations])

  useEffect(() => {
    localStorage.setItem(storageKeys.templates, JSON.stringify(templates))
  }, [templates])

  useEffect(() => {
    localStorage.setItem(storageKeys.calculations, JSON.stringify(calculations))
  }, [calculations])

  useEffect(() => {
    localStorage.setItem(storageKeys.letterheadDraft, JSON.stringify(letterheadForm))
  }, [letterheadForm])

  useEffect(() => {
    localStorage.setItem(storageKeys.broadcasts, JSON.stringify(broadcasts))
  }, [broadcasts])

  useEffect(() => {
    localStorage.setItem(storageKeys.auditLogs, JSON.stringify(auditLogs))
  }, [auditLogs])

  useEffect(() => {
    const clockIntervalId = window.setInterval(() => setCurrentNow(new Date()), 30000)

    return () => window.clearInterval(clockIntervalId)
  }, [])

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true)
    }

    function handleOffline() {
      setIsOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    const intervalId = window.setInterval(refreshSyncQueueCount, 5000)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    async function hydrateOfflineQueue() {
      const userKey = session?.email?.toLowerCase() ?? 'local'

      try {
        const indexedQueue = await listOfflineSyncRecords(userKey)

        if (indexedQueue.length > 0) {
          savePendingSyncQueue(indexedQueue)
          setPendingSyncItems(indexedQueue)
          setSyncQueueCount(indexedQueue.length)
        } else {
          refreshSyncQueueCount()
        }
      } catch {
        refreshSyncQueueCount()
      }
    }

    hydrateOfflineQueue()
  }, [session?.email])

  useEffect(() => {
    if (!session?.token) {
      return undefined
    }

    if (sessionExpiresAt && sessionExpiresAt <= Date.now()) {
      handleLogout()
      return undefined
    }

    const intervalId = window.setInterval(() => {
      const currentSession = loadStoredValueFrom<Session | null>(sessionStorage, storageKeys.session, null)
      const currentExpiresAt = getSessionExpiresAt(currentSession)

      if (currentExpiresAt && currentExpiresAt <= Date.now()) {
        localStorage.removeItem(storageKeys.session)
        sessionStorage.removeItem(storageKeys.session)
        setSession(null)
        setActiveView('inbox')
      }
    }, 30000)

    return () => window.clearInterval(intervalId)
  }, [session?.token, sessionExpiresAt])

  useEffect(() => {
    if (registrationRequired && session?.role === 'admin' && activeView !== 'seguranca') {
      setSettingsMenuOpen(true)
      setActiveView('seguranca')
    }
  }, [activeView, registrationRequired, session?.role])

  useEffect(() => {
    async function loadApiData() {
      const health = await apiRequest<{ ok: boolean }>('/api/health')

      if (!health?.ok) {
        setApiStatus('local')
        return
      }

      if (!session?.token) {
        setApiStatus('online')
        return
      }

      const [apiConversations, apiTemplates, apiUsers, apiAuditLogs, apiSystemStatus, apiBroadcasts, apiIntegrationStatus, apiEmailSettings, apiCompanySettings] = await Promise.all([
        apiRequest<Conversation[]>('/api/conversations'),
        apiRequest<Template[]>('/api/templates'),
        apiRequest<User[]>('/api/users'),
        session.role === 'admin' ? apiRequest<AuditLog[]>(buildAuditLogPath(auditFilters)) : Promise.resolve(null),
        session.role === 'admin' ? apiRequest<SystemStatus>('/api/system?action=status') : Promise.resolve(null),
        canAccess('disparos', session) ? apiRequest<Broadcast[]>('/api/broadcasts') : Promise.resolve(null),
        canAccess('disparos', session) ? apiRequest<IntegrationStatus>('/api/broadcasts?integrations=1') : Promise.resolve(null),
        session.role === 'admin' ? apiRequest<EmailSettings>('/api/system?action=email-settings') : Promise.resolve(null),
        session.role === 'admin' ? apiRequest<CompanySettings>('/api/system?action=company-settings') : Promise.resolve(null),
      ])
      const apiCalculations = await apiRequest<Calculation[]>('/api/calculations')

      if (apiConversations?.length) {
        setConversations(apiConversations)
        setSelectedId(apiConversations[0].id)
      }

      if (apiTemplates?.length) {
        setTemplates(apiTemplates)
      }

      if (apiCalculations?.length) {
        setCalculations(apiCalculations)
      }

      if (apiUsers?.length) {
        setUsers(apiUsers)
      }

      if (apiAuditLogs?.length) {
        setAuditLogs(apiAuditLogs)
      }

      if (apiSystemStatus) {
        setSystemStatus(apiSystemStatus)
      }

      if (apiBroadcasts) {
        setBroadcasts(apiBroadcasts)
      }

      if (apiIntegrationStatus) {
        setIntegrationStatus(apiIntegrationStatus)
      }

      if (apiEmailSettings) {
        setEmailSettings(apiEmailSettings)
      }

      if (apiCompanySettings) {
        setCompanySettings({ ...defaultCompanySettings, ...apiCompanySettings })
      }

      setApiStatus('online')
    }

    loadApiData()
  }, [auditFilters, session?.role, session?.token, syncVersion])

  const filteredConversations = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    return conversations.filter((conversation) => {
      const matchesChannel = channelFilter === 'todos' || conversation.channel === channelFilter
      const matchesStatus = statusFilter === 'todos' || conversation.status === statusFilter
      const searchable = [
        conversation.contact,
        conversation.company,
        conversation.phone,
        conversation.email,
        conversation.subject,
      ]
        .join(' ')
        .toLowerCase()

      return matchesChannel && matchesStatus && searchable.includes(normalizedSearch)
    })
  }, [channelFilter, conversations, searchTerm, statusFilter])

  const selectedConversation =
    conversations.find((conversation) => conversation.id === selectedId) ?? conversations[0]

  const metrics = [
    { label: 'Novas mensagens', value: conversations.filter((item) => item.status === 'novo').length, icon: Inbox },
    { label: 'Em atendimento', value: conversations.filter((item) => item.status === 'em_atendimento').length, icon: Clock3 },
    { label: 'Retornos hoje', value: conversations.filter((item) => item.status === 'retorno' && isToday(item.scheduledAt)).length, icon: CalendarClock },
    { label: 'Concluidos', value: conversations.filter((item) => item.status === 'concluido').length, icon: CheckCircle2 },
  ]
  const broadcastMetrics = [
    { label: 'Preparados', value: broadcasts.filter((item) => item.status === 'fila_preparada' || item.status === 'agendado').length, icon: Inbox },
    { label: 'Enviados', value: broadcasts.reduce((sum, item) => sum + (item.sentCount ?? (item.status === 'enviado' ? item.recipientCount : 0)), 0), icon: CheckCircle2 },
    { label: 'Pendentes', value: broadcasts.filter((item) => item.status === 'aguardando_integracao').length, icon: Clock3 },
    { label: 'Destinatarios', value: broadcasts.reduce((sum, item) => sum + item.recipientCount, 0), icon: Send },
  ]
  const activeMetrics = activeView === 'disparos' ? broadcastMetrics : metrics
  const reportData = useMemo(() => {
    const totalConversations = conversations.length
    const whatsappConversations = conversations.filter((item) => item.channel === 'whatsapp').length
    const emailConversations = conversations.filter((item) => item.channel === 'email').length
    const openConversations = conversations.filter((item) => item.status !== 'concluido').length
    const concludedConversations = conversations.filter((item) => item.status === 'concluido').length
    const returnsToday = conversations.filter((item) => item.scheduledAt && isToday(item.scheduledAt)).length
    const futureReturns = conversations.filter((item) => item.scheduledAt && isFutureDate(item.scheduledAt)).length
    const overdueReturns = conversations.filter((item) => item.scheduledAt && item.status !== 'concluido' && isPastDate(item.scheduledAt)).length
    const totalMessages = conversations.reduce((sum, item) => sum + item.messages.length, 0)
    const totalCalculationValue = calculations.reduce((sum, item) => sum + item.estimatedTotal, 0)
    const judicialCalculations = calculations.filter((item) => item.kind === 'judicial').length
    const previdenciarioCalculations = calculations.filter((item) => item.kind === 'previdenciario').length
    const totalRecipients = broadcasts.reduce((sum, item) => sum + item.recipientCount, 0)
    const whatsappBroadcasts = broadcasts.filter((item) => item.channel === 'whatsapp').length
    const emailBroadcasts = broadcasts.filter((item) => item.channel === 'email').length
    const latestAudit = auditLogs[0]
    const latestConversation = [...conversations]
      .filter((item) => item.createdAt)
      .sort((first, second) => new Date(second.createdAt ?? '').getTime() - new Date(first.createdAt ?? '').getTime())[0]

    return {
      totalConversations,
      whatsappConversations,
      emailConversations,
      openConversations,
      concludedConversations,
      returnsToday,
      futureReturns,
      overdueReturns,
      totalMessages,
      totalCalculationValue,
      averageCalculationValue: calculations.length ? totalCalculationValue / calculations.length : 0,
      judicialCalculations,
      previdenciarioCalculations,
      totalRecipients,
      whatsappBroadcasts,
      emailBroadcasts,
      latestAudit,
      latestConversation,
      statusRows: (Object.keys(statusLabel) as Status[]).map((status) => {
        const count = conversations.filter((item) => item.status === status).length
        return { label: statusLabel[status], count, percent: percent(count, totalConversations) }
      }),
      calculationRows: (Object.keys(calculationKindLabel) as CalculationKind[]).map((kind) => {
        const count = calculations.filter((item) => item.kind === kind).length
        return { label: calculationKindLabel[kind], count, percent: percent(count, calculations.length) }
      }),
      channelRows: [
        { label: 'WhatsApp', count: whatsappConversations, percent: percent(whatsappConversations, totalConversations) },
        { label: 'E-mail', count: emailConversations, percent: percent(emailConversations, totalConversations) },
      ],
    }
  }, [auditLogs, broadcasts, calculations, conversations])
  const auditActions = useMemo(
    () => [...new Set(auditLogs.map((log) => log.action))].sort(),
    [auditLogs],
  )

  async function refreshAuditLogs() {
    if (session?.role !== 'admin') {
      return
    }

    const nextAuditLogs = await apiRequest<AuditLog[]>(buildAuditLogPath(auditFilters))

    if (nextAuditLogs) {
      setAuditLogs(nextAuditLogs)
    }
  }

  async function refreshSystemStatus() {
    if (session?.role !== 'admin') {
      return
    }

    const nextStatus = await apiRequest<SystemStatus>('/api/system?action=status')

    if (nextStatus) {
      setSystemStatus(nextStatus)
      setSecurityMessage('Diagnostico atualizado.')
    }
  }

  async function synchronizeOfflineQueue() {
    const queue = getPendingSyncQueue()

    if (queue.length === 0) {
      setSyncMessage('Nenhuma acao pendente para sincronizar.')
      return
    }

    const storedSession = loadStoredValueFrom<Session | null>(sessionStorage, storageKeys.session, null)

    if (!storedSession?.token) {
      setSyncMessage('Entre novamente para sincronizar as acoes pendentes.')
      return
    }

    let synchronized = 0
    const remaining: PendingSyncItem[] = []

    for (const item of queue) {
      try {
        const response = await fetch(`${apiBaseUrl}${item.path}`, {
          method: item.method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${storedSession.token}`,
          },
          body: item.body,
        })

        if (!response.ok) {
          throw new Error(`status ${response.status}`)
        }

        synchronized += 1
        await deleteOfflineSyncRecord(item.id)
      } catch (error) {
        const failedItem = {
          ...item,
          attempts: item.attempts + 1,
          lastError: error instanceof Error ? error.message : 'Falha ao sincronizar',
        }
        remaining.push(failedItem)
        await putOfflineSyncRecord(failedItem)
      }
    }

    savePendingSyncQueue(remaining)
    setPendingSyncItems(remaining)
    setSyncQueueCount(remaining.length)
    setSyncMessage(
      remaining.length === 0
        ? `${synchronized} acao(oes) sincronizada(s).`
        : `${synchronized} acao(oes) sincronizada(s), ${remaining.length} ainda pendente(s).`,
    )
    setSyncVersion((current) => current + 1)
  }

  async function discardPendingSyncItem(itemId: string) {
    const remaining = getPendingSyncQueue().filter((item) => item.id !== itemId)
    savePendingSyncQueue(remaining)
    await deleteOfflineSyncRecord(itemId)
    setPendingSyncItems(remaining)
    setSyncQueueCount(remaining.length)
    setSyncMessage('Pendencia removida da fila local.')
  }

  useEffect(() => {
    if (isOnline && session?.token && syncQueueCount > 0) {
      synchronizeOfflineQueue()
    }
  }, [isOnline, session?.token])

  async function submitRegistrationKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSecurityMessage('')

    const nextStatus = await apiRequest<SystemStatus>('/api/system?action=register', {
      method: 'POST',
      body: JSON.stringify({ registrationKey }),
    })

    if (!nextStatus) {
      setSecurityMessage('Nao foi possivel registrar. Confira a chave e tente novamente.')
      return
    }

    setSystemStatus(nextStatus)
    setRegistrationKey('')
    setSecurityMessage('Sistema registrado com sucesso.')
    await refreshAuditLogs()
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoginError('')

    const apiSession = await apiRequest<Session>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: loginEmail, password: loginPassword }),
    })
    const nextSession =
      apiSession ??
      (shouldUseApi
        ? null
        : {
            name: loginEmail.split('@')[0] || 'Usuario',
            email: loginEmail,
            role: 'local',
          })

    if (!nextSession) {
      setLoginError('Email ou senha invalidos.')
      return
    }

    localStorage.removeItem(storageKeys.session)
    sessionStorage.setItem(storageKeys.session, JSON.stringify(nextSession))
    setSession(nextSession)
    setLoginPassword('')
    setActiveView('inbox')
  }

  function handleLogout() {
    localStorage.removeItem(storageKeys.session)
    sessionStorage.removeItem(storageKeys.session)
    setSession(null)
  }

  function replaceConversation(nextConversation: Conversation) {
    setConversations((current) =>
      current.map((conversation) => (conversation.id === nextConversation.id ? nextConversation : conversation)),
    )
  }

  async function addContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextConversation: Conversation = {
      id: Date.now(),
      contact: contactForm.contact,
      company: contactForm.company || contactForm.contact,
      phone: contactForm.phone,
      email: contactForm.email,
      channel: contactForm.channel,
      subject: contactForm.subject || 'Novo atendimento',
      status: 'novo',
      priority: 'normal',
      responsible: session?.name ?? 'Sem responsavel',
      lastUpdate: formatDateTime(new Date().toISOString()),
      createdAt: new Date().toISOString(),
      scheduledAt: contactForm.scheduledAt || undefined,
      nextAction: contactForm.scheduledAt ? `Retorno em ${formatDateTime(contactForm.scheduledAt)}` : 'Iniciar atendimento',
      messages: [
        {
          id: 1,
          author: 'client',
          text: 'Contato cadastrado manualmente.',
          time: formatDateTime(new Date().toISOString()),
        },
      ],
    }

    const savedConversation = await apiRequest<Conversation>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify(nextConversation),
    })
    const conversationToUse = savedConversation ?? nextConversation

    setConversations((current) => [conversationToUse, ...current])
    setSelectedId(conversationToUse.id)
    setContactForm({ contact: '', company: '', phone: '', email: '', channel: 'whatsapp', subject: '', scheduledAt: '' })
    refreshSyncQueueCount()
    await refreshAuditLogs()
  }

  async function addTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const localTemplate = { id: Date.now(), ...templateForm }
    const savedTemplate = await apiRequest<Template>('/api/templates', {
      method: 'POST',
      body: JSON.stringify(localTemplate),
    })

    setTemplates((current) => [savedTemplate ?? localTemplate, ...current])
    setTemplateForm({ title: '', body: '' })
    refreshSyncQueueCount()
    await refreshAuditLogs()
  }

  async function deleteTemplate(template: Template) {
    if (!window.confirm(`Excluir o modelo "${template.title}"?`)) {
      return
    }

    await apiRequest<{ ok: boolean }>(`/api/templates?id=${template.id}`, { method: 'DELETE' })
    setTemplates((current) => current.filter((item) => item.id !== template.id))
    refreshSyncQueueCount()
    await refreshAuditLogs()
  }

  async function addCalculation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const principal = Number(calculationForm.principal || 0)
    const correction = Number(calculationForm.correction || 0)
    const interest = Number(calculationForm.interest || 0)
    const fees = Number(calculationForm.fees || 0)
    const nextCalculation: Calculation = {
      id: Date.now(),
      kind: calculationForm.kind,
      formula: calculationForm.formula,
      clientName: calculationForm.clientName,
      reference: calculationForm.reference,
      description: calculationForm.description,
      principal,
      correction,
      interest,
      fees,
      estimatedTotal: principal + correction + interest + fees,
      status: 'em_revisao',
      createdAt: new Date().toISOString(),
    }
    const savedCalculation = await apiRequest<Calculation>('/api/calculations', {
      method: 'POST',
      body: JSON.stringify(nextCalculation),
    })

    setCalculations((current) => [savedCalculation ?? nextCalculation, ...current])
    setCalculationForm({
      kind: 'judicial',
      formula: 'livre',
      clientName: '',
      reference: '',
      description: '',
      principal: '',
      correction: '',
      interest: '',
      fees: '',
    })
    refreshSyncQueueCount()
    await refreshAuditLogs()
  }

  async function deleteCalculation(calculation: Calculation) {
    if (!window.confirm(`Excluir o calculo de ${calculation.clientName}?`)) {
      return
    }

    await apiRequest<{ ok: boolean }>(`/api/calculations?id=${calculation.id}`, { method: 'DELETE' })
    setCalculations((current) => current.filter((item) => item.id !== calculation.id))
    refreshSyncQueueCount()
    await refreshAuditLogs()
  }

  async function addBroadcast(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (broadcastForm.channel === 'email' && !integrationStatus?.email) {
      setBroadcastMessage('Cadastre e salve uma conta SMTP em Configuracao > Seguranca antes de preparar disparos por e-mail.')
      return
    }

    if (broadcastForm.channel === 'email' && !broadcastForm.subject.trim()) {
      setBroadcastMessage('Informe o assunto do e-mail antes de preparar o disparo.')
      return
    }

    if (broadcastForm.channel === 'whatsapp' && isTechnicalWhatsAppPayload(broadcastForm.message)) {
      setBroadcastMessage('Nao cole comando curl, token ou Authorization na mensagem. Informe apenas o texto que sera enviado ao cliente.')
      return
    }

    const recipientCount = broadcastForm.recipients
      .split(/\r?\n|,/)
      .map((recipient) => recipient.trim())
      .filter(Boolean).length
    const nextBroadcast: Broadcast = {
      id: Date.now(),
      channel: broadcastForm.channel,
      name: broadcastForm.name,
      subject: broadcastForm.subject || null,
      senderAccount: broadcastForm.channel === 'email' ? broadcastForm.senderAccount || null : null,
      whatsappTemplateName: broadcastForm.channel === 'whatsapp' ? broadcastForm.whatsappTemplateName || null : null,
      whatsappTemplateLanguage: broadcastForm.channel === 'whatsapp' ? broadcastForm.whatsappTemplateLanguage || null : null,
      message: broadcastForm.message,
      recipients: broadcastForm.recipients,
      recipientCount,
      sentCount: 0,
      failedCount: 0,
      status: broadcastForm.scheduledAt ? 'agendado' : 'fila_preparada',
      scheduledAt: broadcastForm.scheduledAt || null,
      createdByEmail: session?.email,
      createdAt: new Date().toISOString(),
    }
    const savedBroadcast = await apiRequest<Broadcast>('/api/broadcasts', {
      method: 'POST',
      body: JSON.stringify(nextBroadcast),
    })

    setBroadcasts((current) => [savedBroadcast ?? nextBroadcast, ...current])
    setBroadcastForm({ channel: 'whatsapp', name: '', subject: '', senderAccount: '', whatsappTemplateName: '', whatsappTemplateLanguage: 'en_US', message: '', recipients: '', scheduledAt: '' })
    refreshSyncQueueCount()
    await refreshAuditLogs()
  }

  async function loadBroadcastTextTemplate(templatePath: string) {
    if (!templatePath) {
      return
    }

    const response = await fetch(templatePath)

    if (!response.ok) {
      setBroadcastMessage('Nao foi possivel carregar o modelo de mensagem.')
      return
    }

    const text = await response.text()
    setBroadcastForm((current) => ({ ...current, message: text.trim() }))
    setBroadcastMessage('Modelo de mensagem carregado.')
  }

  async function deleteBroadcast(broadcast: Broadcast) {
    if (!window.confirm(`Excluir o disparo "${broadcast.name}"?`)) {
      return
    }

    await apiRequest<{ ok: boolean }>(`/api/broadcasts?id=${broadcast.id}`, { method: 'DELETE' })
    setBroadcasts((current) => current.filter((item) => item.id !== broadcast.id))
    refreshSyncQueueCount()
    await refreshAuditLogs()
  }

  async function deleteConversation(conversation: Conversation) {
    if (!window.confirm(`Excluir o contato/atendimento de ${conversation.contact}?`)) {
      return
    }

    await apiRequest<{ ok: boolean }>(`/api/conversations/${conversation.id}`, { method: 'DELETE' })
    setConversations((current) => {
      const next = current.filter((item) => item.id !== conversation.id)
      setSelectedId(next[0]?.id ?? 0)
      return next
    })
    refreshSyncQueueCount()
    await refreshAuditLogs()
  }

  function exportReportsCsv() {
    const reportGroups: Record<ReportKind, string[]> = {
      completo: ['Atendimentos', 'Agenda', 'Canais', 'Produtividade', 'Calculos', 'Disparos', 'Seguranca'],
      atendimentos: ['Atendimentos', 'Canais'],
      agenda: ['Agenda', 'Produtividade'],
      calculos: ['Calculos'],
      disparos: ['Disparos'],
      seguranca: ['Seguranca'],
    }
    const allRows = [
      ['Atendimentos', 'Atendimentos registrados', reportData.totalConversations],
      ['Atendimentos', 'Atendimentos abertos', reportData.openConversations],
      ['Atendimentos', 'Atendimentos concluidos', reportData.concludedConversations],
      ['Atendimentos', 'Taxa de conclusao', `${percent(reportData.concludedConversations, reportData.totalConversations)}%`],
      ['Agenda', 'Retornos para hoje', reportData.returnsToday],
      ['Agenda', 'Retornos futuros', reportData.futureReturns],
      ['Agenda', 'Retornos em atraso', reportData.overdueReturns],
      ['Canais', 'WhatsApp', reportData.whatsappConversations],
      ['Canais', 'Email', reportData.emailConversations],
      ['Produtividade', 'Mensagens no historico', reportData.totalMessages],
      ['Produtividade', 'Modelos de resposta', templates.length],
      ['Calculos', 'Calculos cadastrados', calculations.length],
      ['Calculos', 'Judiciais', reportData.judicialCalculations],
      ['Calculos', 'Previdenciarios', reportData.previdenciarioCalculations],
      ['Calculos', 'Total estimado', reportData.totalCalculationValue.toFixed(2)],
      ['Calculos', 'Media por calculo', reportData.averageCalculationValue.toFixed(2)],
      ['Disparos', 'Campanhas preparadas', broadcasts.length],
      ['Disparos', 'Destinatarios na fila', reportData.totalRecipients],
      ['Disparos', 'WhatsApp', reportData.whatsappBroadcasts],
      ['Disparos', 'Email', reportData.emailBroadcasts],
      ['Seguranca', 'Usuarios cadastrados', users.length],
      ['Seguranca', 'Eventos auditados', auditLogs.length],
      ['Seguranca', 'Banco de dados', systemStatus?.database.ok ? 'Online' : apiStatus === 'online' ? 'Online' : 'Local'],
    ]
    const rows = [
      ['Grupo', 'Indicador', 'Valor'],
      ...allRows.filter((row) => reportGroups[reportKind].includes(String(row[0]))),
    ]
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
      .join('\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `jusprevconecta-relatorio-${reportKind}-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  function printReports() {
    const printWindow = window.open('', '_blank', 'width=980,height=920')

    if (!printWindow) {
      return
    }

    const escapeHtml = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')

    const printLogo = companySettings.logoDataUrl || `${window.location.origin}/logo-cropped.png`
    const printCompanyName = companySettings.tradeName || companySettings.name || 'JusPrevConecta'
    const printCompanyLegalLine =
      companySettings.name && companySettings.name !== printCompanyName
        ? companySettings.name
        : 'Solucoes juridicas e previdenciarias'
    const printCompanyContactLine = [companySettings.document, companySettings.phone, companySettings.email].filter(Boolean).join(' | ')
    const printCompanyAddressLine = [
      companySettings.address,
      companySettings.city,
      companySettings.state,
      companySettings.zipCode,
    ].filter(Boolean).join(' - ')
    const printCompanyFooterLine = [printCompanyName, printCompanyContactLine, printCompanyAddressLine].filter(Boolean).join(' | ')
    const reportTitles: Record<ReportKind, string> = {
      completo: 'Relatorio executivo completo',
      atendimentos: 'Relatorio de atendimentos',
      agenda: 'Relatorio de agenda e produtividade',
      calculos: 'Relatorio de calculos',
      disparos: 'Relatorio de disparos',
      seguranca: 'Relatorio de seguranca e auditoria',
    }
    const statusRows = reportData.statusRows
      .map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.count}</td><td>${row.percent}%</td></tr>`)
      .join('')
    const channelRows = reportData.channelRows
      .map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.count}</td><td>${row.percent}%</td></tr>`)
      .join('')
    const calculationRows = reportData.calculationRows
      .map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.count}</td><td>${row.percent}%</td></tr>`)
      .join('')
    const auditSummary = reportData.latestAudit
      ? `${reportData.latestAudit.summary} em ${formatDateTime(reportData.latestAudit.createdAt)}`
      : 'Sem evento registrado'
    const databaseStatus = systemStatus?.database.ok ? 'Online' : apiStatus === 'online' ? 'Online' : 'Local'
    const shouldShow = (kind: ReportKind) => reportKind === 'completo' || reportKind === kind
    const summaryCards = [
      ['Atendimentos', reportData.totalConversations],
      ['Abertos', reportData.openConversations],
      ['Conclusao', `${percent(reportData.concludedConversations, reportData.totalConversations)}%`],
      ['Retornos hoje', reportData.returnsToday],
      ['Atrasados', reportData.overdueReturns],
      ['Total em calculos', formatCurrency(reportData.totalCalculationValue)],
    ]
      .map(([label, value]) => `<div class="card"><span>${escapeHtml(String(label))}</span><strong>${escapeHtml(String(value))}</strong></div>`)
      .join('')
    const sections = [
      shouldShow('atendimentos') ? `
        <section class="report-section">
          <h2>Atendimentos</h2>
          <table>
            <tbody>
              <tr><td>Atendimentos registrados</td><td>${reportData.totalConversations}</td></tr>
              <tr><td>Atendimentos abertos</td><td>${reportData.openConversations}</td></tr>
              <tr><td>Atendimentos concluidos</td><td>${reportData.concludedConversations}</td></tr>
              <tr><td>Taxa de conclusao</td><td>${percent(reportData.concludedConversations, reportData.totalConversations)}%</td></tr>
            </tbody>
          </table>
          <h3>Status dos atendimentos</h3>
          <table>
            <thead><tr><th>Status</th><th>Qtd.</th><th>%</th></tr></thead>
            <tbody>${statusRows}</tbody>
          </table>
          <h3>Canais de entrada</h3>
          <table>
            <thead><tr><th>Canal</th><th>Qtd.</th><th>%</th></tr></thead>
            <tbody>${channelRows}</tbody>
          </table>
        </section>
      ` : '',
      shouldShow('agenda') ? `
        <section class="report-section">
          <h2>Agenda e produtividade</h2>
          <table>
            <tbody>
              <tr><td>Retornos para hoje</td><td>${reportData.returnsToday}</td></tr>
              <tr><td>Retornos futuros</td><td>${reportData.futureReturns}</td></tr>
              <tr><td>Retornos em atraso</td><td>${reportData.overdueReturns}</td></tr>
              <tr><td>Mensagens no historico</td><td>${reportData.totalMessages}</td></tr>
              <tr><td>Modelos de resposta</td><td>${templates.length}</td></tr>
              <tr><td>Ultimo atendimento</td><td>${escapeHtml(formatDate(reportData.latestConversation?.createdAt))}</td></tr>
            </tbody>
          </table>
        </section>
      ` : '',
      shouldShow('calculos') ? `
        <section class="report-section">
          <h2>Calculos judiciais e previdenciarios</h2>
          <table>
            <tbody>
              <tr><td>Calculos cadastrados</td><td>${calculations.length}</td></tr>
              <tr><td>Judiciais</td><td>${reportData.judicialCalculations}</td></tr>
              <tr><td>Previdenciarios</td><td>${reportData.previdenciarioCalculations}</td></tr>
              <tr><td>Total estimado</td><td>${formatCurrency(reportData.totalCalculationValue)}</td></tr>
              <tr><td>Media por calculo</td><td>${formatCurrency(reportData.averageCalculationValue)}</td></tr>
            </tbody>
          </table>
          <h3>Distribuicao por area</h3>
          <table>
            <thead><tr><th>Area</th><th>Qtd.</th><th>%</th></tr></thead>
            <tbody>${calculationRows}</tbody>
          </table>
        </section>
      ` : '',
      shouldShow('disparos') ? `
        <section class="report-section">
          <h2>Disparos</h2>
          <table>
            <tbody>
              <tr><td>Campanhas preparadas</td><td>${broadcasts.length}</td></tr>
              <tr><td>Destinatarios na fila</td><td>${reportData.totalRecipients}</td></tr>
              <tr><td>Campanhas WhatsApp</td><td>${reportData.whatsappBroadcasts}</td></tr>
              <tr><td>Campanhas por e-mail</td><td>${reportData.emailBroadcasts}</td></tr>
            </tbody>
          </table>
        </section>
      ` : '',
      shouldShow('seguranca') ? `
        <section class="report-section">
          <h2>Seguranca e auditoria</h2>
          <table>
            <tbody>
              <tr><td>Usuarios cadastrados</td><td>${users.length}</td></tr>
              <tr><td>Eventos auditados</td><td>${auditLogs.length}</td></tr>
              <tr><td>Banco de dados</td><td>${escapeHtml(databaseStatus)}</td></tr>
              <tr><td>Ultimo evento</td><td>${escapeHtml(auditSummary)}</td></tr>
            </tbody>
          </table>
        </section>
      ` : '',
    ].filter(Boolean).join('')

    printWindow.document.write(`
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(reportTitles[reportKind])} - ${escapeHtml(printCompanyName)}</title>
          <style>
            @page { size: A4 portrait; margin: 12mm 13mm; }
            * { box-sizing: border-box; }
            html, body { margin: 0; background: #ffffff; color: #172033; font-family: Arial, sans-serif; }
            html { scrollbar-width: none; }
            html::-webkit-scrollbar, body::-webkit-scrollbar { width: 0; height: 0; }
            body { padding: 0; overflow: hidden; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .page { min-height: 270mm; position: relative; overflow: hidden; }
            header { border-bottom: 3px solid #0b3b82; padding-bottom: 8mm; display: grid; grid-template-columns: minmax(0, 58mm) minmax(0, 1fr); align-items: end; gap: 9mm; position: relative; z-index: 2; }
            header img { width: 56mm; max-width: 100%; max-height: 24mm; object-fit: contain; }
            header div { min-width: 0; display: grid; gap: 1.8mm; text-align: right; color: #607086; font-size: 9.5pt; overflow-wrap: anywhere; }
            header strong { color: #0b3b82; font-size: 15pt; overflow-wrap: anywhere; }
            .watermark { width: 118mm; max-height: 86mm; object-fit: contain; position: fixed; top: 55%; left: 50%; opacity: 0.075; transform: translate(-50%, -50%); z-index: 1; }
            main { position: relative; z-index: 2; }
            h1 { margin: 8mm 0 3mm; font-size: 21pt; }
            h2 { margin: 6mm 0 3mm; color: #0b3b82; font-size: 13.5pt; }
            h3 { margin: 4mm 0 2mm; color: #172033; font-size: 11pt; }
            p { margin: 0 0 3mm; line-height: 1.4; }
            .meta { color: #607086; font-size: 10pt; }
            .cards { margin: 6mm 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; }
            .card { border: 1px solid #d9e1ec; border-radius: 3mm; padding: 3mm; background: #f8fbff; }
            .card span { color: #607086; display: block; font-size: 8.8pt; }
            .card strong { display: block; margin-top: 1mm; color: #172033; font-size: 16pt; }
            .report-section { break-inside: avoid; margin-top: 4mm; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 4mm; background: rgba(255, 255, 255, 0.94); }
            th, td { border: 1px solid #d9e1ec; padding: 2.2mm; text-align: left; font-size: 9.2pt; }
            th { background: #eef2f7; color: #172033; }
            .footer { margin-top: 7mm; border-top: 1px solid #d9e1ec; padding-top: 4mm; color: #607086; font-size: 8.2pt; line-height: 1.4; text-align: center; }
            @media print {
              body { overflow: visible; }
              .page { break-after: auto; }
            }
          </style>
        </head>
        <body>
          <section class="page">
            <header>
              <img src="${printLogo}" alt="${escapeHtml(printCompanyName)}" />
              <div>
                <strong>${escapeHtml(printCompanyName)}</strong>
                <span>${escapeHtml(printCompanyLegalLine)}</span>
                ${printCompanyContactLine ? `<span>${escapeHtml(printCompanyContactLine)}</span>` : ''}
                ${printCompanyAddressLine ? `<span>${escapeHtml(printCompanyAddressLine)}</span>` : ''}
              </div>
            </header>
            <img class="watermark" src="${printLogo}" alt="" />
            <main>
              <h1>${escapeHtml(reportTitles[reportKind])}</h1>
              <p class="meta">Gerado em ${formatDateTime(new Date().toISOString())} por ${escapeHtml(session?.name ?? 'Sistema')}.</p>

              <div class="cards">
                ${summaryCards}
              </div>
              ${sections}
            </main>
            ${printCompanyFooterLine ? `<footer class="footer">${escapeHtml(printCompanyFooterLine)}</footer>` : ''}
          </section>
          <script>
            window.addEventListener('load', () => {
              window.focus();
              window.print();
            });
          </script>
        </body>
      </html>
    `)
    printWindow.document.close()
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setUserMessage('')

    if (!editingUserId && userForm.password.length < 6) {
      setUserMessage('Informe uma senha com pelo menos 6 caracteres.')
      return
    }

    const localUser: User = {
      id: editingUserId ?? Date.now(),
      name: userForm.name,
      email: userForm.email,
      role: userForm.role,
      createdAt: new Date().toISOString(),
    }
    const savedUser = await apiRequest<User>('/api/users', {
      method: editingUserId ? 'PUT' : 'POST',
      body: JSON.stringify({ ...userForm, id: editingUserId }),
    })

    setUsers((current) => {
      if (editingUserId) {
        return current.map((user) => (user.id === editingUserId ? { ...user, ...(savedUser ?? localUser) } : user))
      }

      return [savedUser ?? localUser, ...current]
    })
    setUserForm({ name: '', email: '', password: '', role: 'atendente' })
    setEditingUserId(null)
    setUserMessage(editingUserId ? 'Usuario atualizado.' : 'Usuario criado.')
    refreshSyncQueueCount()
    await refreshAuditLogs()
  }

  function startEditUser(user: User) {
    setEditingUserId(user.id)
    setUserForm({ name: user.name, email: user.email, password: '', role: user.role })
    setUserMessage('Editando usuario. Preencha a senha apenas se quiser alterar.')
  }

  function cancelEditUser() {
    setEditingUserId(null)
    setUserForm({ name: '', email: '', password: '', role: 'atendente' })
    setUserMessage('')
  }

  async function deleteUser(user: User) {
    if (session?.id === user.id) {
      setUserMessage('Nao e permitido excluir o proprio usuario logado.')
      return
    }

    if (!window.confirm(`Excluir o usuario ${user.name}?`)) {
      return
    }

    await apiRequest<{ ok: boolean }>(`/api/users?id=${user.id}`, { method: 'DELETE' })
    setUsers((current) => current.filter((item) => item.id !== user.id))
    setUserMessage('Usuario excluido.')
    refreshSyncQueueCount()
    await refreshAuditLogs()
  }

  function addEmailAccountToSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedId = emailAccountForm.id.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
    const nextAccount = {
      ...emailAccountForm,
      id: normalizedId || `conta-${Date.now()}`,
      port: Number(emailAccountForm.port || 587),
      from: emailAccountForm.from || emailAccountForm.user,
    }

    setEmailSettings((current) => ({
      accounts: [...current.accounts.filter((account) => account.id !== nextAccount.id), nextAccount],
    }))
    setEmailAccountForm({
      id: 'atendimento',
      label: 'Atendimento',
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      user: '',
      from: '',
      pass: '',
    })
    setEmailSettingsMessage('Conta adicionada a lista. Clique em Salvar configuracao.')
  }

  function removeEmailAccountFromSettings(accountId: string) {
    setEmailSettings((current) => ({ accounts: current.accounts.filter((account) => account.id !== accountId) }))
    setEmailSettingsMessage('Conta removida da lista. Clique em Salvar configuracao.')
  }

  async function saveEmailAccountSettings() {
    setEmailSettingsMessage('Salvando configuracao de e-mail...')
    const savedSettings = await apiRequest<EmailSettings>('/api/system?action=email-settings', {
      method: 'PUT',
      body: JSON.stringify({ accounts: emailSettings.accounts }),
    })

    if (!savedSettings) {
      setEmailSettingsMessage('Nao foi possivel salvar agora. Verifique a conexao com a API.')
      refreshSyncQueueCount()
      return
    }

    setEmailSettings(savedSettings)
    const nextIntegrationStatus = await apiRequest<IntegrationStatus>('/api/broadcasts?integrations=1')
    if (nextIntegrationStatus) {
      setIntegrationStatus(nextIntegrationStatus)
    }
    setEmailSettingsMessage('Configuracao de e-mail salva com seguranca.')
    await refreshAuditLogs()
  }

  function handleCompanyLogoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      setCompanySettingsMessage('Selecione um arquivo de imagem valido.')
      event.target.value = ''
      return
    }

    if (file.size > 1_500_000) {
      setCompanySettingsMessage('A logo precisa ter ate 1,5 MB para salvar com seguranca.')
      event.target.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      setCompanySettings((current) => ({ ...current, logoDataUrl: String(reader.result || '') }))
      setCompanySettingsMessage('Logo carregada. Clique em Salvar cadastro da empresa.')
    }
    reader.onerror = () => setCompanySettingsMessage('Nao foi possivel ler a logo selecionada.')
    reader.readAsDataURL(file)
  }

  function removeCompanyLogo() {
    setCompanySettings((current) => ({ ...current, logoDataUrl: '' }))
    setCompanySettingsMessage('Logo removida da tela. Clique em Salvar cadastro da empresa.')
  }

  async function saveCompanySettingsProfile(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    setCompanySettingsMessage('Salvando cadastro da empresa...')
    const savedSettings = await apiRequest<CompanySettings>('/api/system?action=company-settings', {
      method: 'PUT',
      body: JSON.stringify(companySettings),
    })

    if (!savedSettings) {
      setCompanySettingsMessage('Nao foi possivel salvar o cadastro agora. Verifique a conexao com a API.')
      refreshSyncQueueCount()
      return
    }

    setCompanySettings({ ...defaultCompanySettings, ...savedSettings })
    setCompanySettingsMessage('Cadastro da empresa salvo. Os dados ja entram nos impressos e PDFs.')
    await refreshAuditLogs()
  }

  async function sendBroadcastNow(broadcast: Broadcast) {
    setBroadcastMessage('Enviando disparo...')
    const result = await apiRequest<{ broadcast: Broadcast; sent: number; failed: number; error?: string; errors?: Array<{ recipient: string; message: string }> }>('/api/broadcasts', {
      method: 'PATCH',
      body: JSON.stringify({ id: broadcast.id, action: 'send' }),
    })

    if (!result) {
      setBroadcastMessage('Nao foi possivel acionar a API de envio agora.')
      refreshSyncQueueCount()
      return
    }

    setBroadcasts((current) => current.map((item) => (item.id === result.broadcast.id ? result.broadcast : item)))
    const firstError = result.errors?.[0]
    setBroadcastMessage(
      result.error
        ? `Falha no envio: ${redactSensitiveText(result.error)}`
        : firstError
          ? `Envio processado: ${result.sent} enviado(s), ${result.failed} falha(s). Primeiro erro em ${firstError.recipient}: ${redactSensitiveText(firstError.message)}`
          : `Envio processado: ${result.sent} enviado(s), ${result.failed} falha(s).`,
    )
    refreshSyncQueueCount()
    await refreshAuditLogs()
  }

  function buildLetterheadPlainText() {
    return [
      companyName,
      companyLegalLine,
      companyContactLine,
      companyAddressLine,
      '',
      `Data: ${formatDate(new Date().toISOString())}`,
      letterheadForm.recipient ? `Destinatario: ${letterheadForm.recipient}` : '',
      letterheadForm.reference ? `Referencia: ${letterheadForm.reference}` : '',
      '',
      letterheadForm.title,
      '',
      letterheadForm.body,
      '',
      letterheadForm.signer,
      letterheadForm.signerRole,
      '',
      companyFooterLine,
    ].filter((line) => line !== '').join('\n')
  }

  function printLetterhead() {
    const printWindow = window.open('', '_blank', 'width=980,height=900')

    if (!printWindow) {
      setDocumentMessage('Nao foi possivel abrir a janela de impressao. Verifique se o navegador bloqueou pop-ups.')
      return
    }

    const escapeHtml = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')

    const paragraphs = letterheadForm.body
      .split('\n')
      .map((paragraph) => `<p>${paragraph ? escapeHtml(paragraph) : '&nbsp;'}</p>`)
      .join('')
    const printableLogo = companySettings.logoDataUrl || `${window.location.origin}/logo-cropped.png`

    printWindow.document.write(`
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(letterheadForm.title || 'Documento')}</title>
          <style>
            @page { size: A4 portrait; margin: 13mm 14mm; }
            * { box-sizing: border-box; }
            html, body { margin: 0; background: #ffffff; color: #172033; font-family: Arial, sans-serif; scrollbar-width: none; }
            html::-webkit-scrollbar, body::-webkit-scrollbar { width: 0; height: 0; }
            body { padding: 0; overflow: hidden; }
            .page { position: relative; display: flex; flex-direction: column; overflow: visible; }
            header { border-bottom: 3px solid #0b3b82; padding-bottom: 8mm; display: grid; grid-template-columns: minmax(0, 58mm) minmax(0, 1fr); align-items: end; gap: 8mm; position: relative; z-index: 2; }
            header img { width: 60mm; max-width: 100%; max-height: 25mm; object-fit: contain; }
            header div { min-width: 0; display: grid; gap: 2mm; text-align: right; color: #607086; font-size: 10pt; overflow-wrap: anywhere; }
            header strong { color: #0b3b82; font-size: 16pt; overflow-wrap: anywhere; }
            .meta { margin: 9mm 0 9mm; display: grid; gap: 2mm; color: #526173; font-size: 10pt; position: relative; z-index: 2; }
            h1 { margin: 0 0 8mm; font-size: 21pt; color: #172033; position: relative; z-index: 2; }
            .body { flex: 1; font-size: 12pt; line-height: 1.52; white-space: pre-wrap; position: relative; z-index: 2; overflow: visible; }
            .body p { margin: 0 0 5mm; break-inside: avoid; }
            .watermark { width: 118mm; max-height: 84mm; object-fit: contain; position: fixed; top: 54%; left: 50%; opacity: 0.16; transform: translate(-50%, -50%); z-index: 1; }
            .signature { margin-top: 13mm; width: 76mm; border-top: 1px solid #172033; padding-top: 3mm; display: grid; gap: 1.5mm; text-align: center; position: relative; z-index: 2; }
            .signature strong { font-size: 11pt; }
            .signature span { color: #607086; font-size: 10pt; }
            .footer { margin-top: 12mm; border-top: 1px solid #d9e1ec; padding-top: 4mm; color: #607086; font-size: 8.5pt; line-height: 1.45; text-align: center; position: relative; z-index: 2; }
            @media print {
              body { overflow: visible; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .page { break-after: auto; }
            }
          </style>
        </head>
        <body>
          <main class="page">
            <header>
              <img src="${printableLogo}" alt="${escapeHtml(companyName)}" />
              <div>
                <strong>${escapeHtml(companyName)}</strong>
                <span>${escapeHtml(companyLegalLine)}</span>
                ${companyContactLine ? `<span>${escapeHtml(companyContactLine)}</span>` : ''}
                ${companyAddressLine ? `<span>${escapeHtml(companyAddressLine)}</span>` : ''}
              </div>
            </header>
            <img class="watermark" src="${printableLogo}" alt="" />
            <section class="meta">
              <span>Data: ${formatDate(new Date().toISOString())}</span>
              ${letterheadForm.recipient ? `<span>Destinatario: ${escapeHtml(letterheadForm.recipient)}</span>` : ''}
              ${letterheadForm.reference ? `<span>Referencia: ${escapeHtml(letterheadForm.reference)}</span>` : ''}
            </section>
            <h1>${escapeHtml(letterheadForm.title)}</h1>
            <section class="body">${paragraphs}</section>
            <section class="signature">
              <strong>${escapeHtml(letterheadForm.signer)}</strong>
              <span>${escapeHtml(letterheadForm.signerRole)}</span>
            </section>
            ${companyFooterLine ? `<footer class="footer">${escapeHtml(companyFooterLine)}</footer>` : ''}
          </main>
          <script>
            window.addEventListener('load', () => {
              window.focus();
              window.print();
            });
          </script>
        </body>
      </html>
    `)
    printWindow.document.close()
    archiveLetterheadDocument()
    clearLetterheadForm('Documento enviado para impressao/PDF. A tela foi limpa para o proximo documento.')
  }

  function clearLetterheadForm(message: string) {
    localStorage.removeItem(storageKeys.letterheadDraft)
    setLetterheadForm(createEmptyLetterheadForm(session?.name ?? 'JusPrevConecta'))
    setDocumentMessage(message)
  }

  function archiveLetterheadDocument() {
    const savedDocument: SavedLetterheadDocument = {
      ...letterheadForm,
      id: Date.now(),
      createdAt: new Date().toISOString(),
      createdByEmail: session?.email,
    }
    const savedDocuments = loadStoredValue<SavedLetterheadDocument[]>(storageKeys.letterheadDocuments, [])

    localStorage.setItem(storageKeys.letterheadDocuments, JSON.stringify([savedDocument, ...savedDocuments]))
  }

  function saveLetterheadDraft() {
    archiveLetterheadDocument()
    clearLetterheadForm('Documento cadastrado. A tela foi limpa para um novo papel timbrado.')
  }

  async function sendLetterheadEmail() {
    setDocumentMessage('')

    if (!letterheadForm.recipientEmail?.trim()) {
      setDocumentMessage('Informe o e-mail do destinatario para enviar o documento.')
      return
    }

    if (!integrationStatus?.email) {
      setDocumentMessage('Cadastre uma conta SMTP em Configuracao > Seguranca antes de enviar documentos por e-mail.')
      return
    }

    const emailAccountId = integrationStatus.emailAccounts?.[0]?.id || ''
    const savedBroadcast = await apiRequest<Broadcast>('/api/broadcasts', {
      method: 'POST',
      body: JSON.stringify({
        channel: 'email',
        name: `Documento - ${letterheadForm.title || 'Sem titulo'}`,
        subject: letterheadForm.title || 'Documento JusPrevConecta',
        senderAccount: emailAccountId,
        message: buildLetterheadPlainText(),
        recipients: letterheadForm.recipientEmail,
        status: 'fila_preparada',
      }),
    })

    if (!savedBroadcast) {
      setDocumentMessage('Nao foi possivel preparar o envio do documento por e-mail.')
      refreshSyncQueueCount()
      return
    }

    setBroadcasts((current) => [savedBroadcast, ...current])

    const result = await apiRequest<{ broadcast: Broadcast; sent: number; failed: number; error?: string; errors?: Array<{ recipient: string; message: string }> }>('/api/broadcasts', {
      method: 'PATCH',
      body: JSON.stringify({ id: savedBroadcast.id, action: 'send' }),
    })

    if (!result) {
      setDocumentMessage('Documento preparado na fila, mas nao foi possivel acionar o envio agora.')
      return
    }

    setBroadcasts((current) => current.map((item) => (item.id === result.broadcast.id ? result.broadcast : item)))
    const firstError = result.errors?.[0]

    if (result.failed > 0) {
      setDocumentMessage(`Falha no envio do documento: ${redactSensitiveText(result.error || firstError?.message || 'verifique a conta SMTP.')}`)
      await refreshAuditLogs()
      return
    }

    archiveLetterheadDocument()
    clearLetterheadForm('Documento enviado por e-mail com sucesso. A tela foi limpa para o proximo documento.')
    await refreshAuditLogs()
  }

  function printCalculation(calculation: Calculation) {
    const printWindow = window.open('', '_blank', 'width=900,height=900')

    if (!printWindow) {
      return
    }

    const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    const escapeHtml = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    const printLogo = companySettings.logoDataUrl || `${window.location.origin}/logo-cropped.png`
    const printCompanyName = companySettings.tradeName || companySettings.name || 'JusPrevConecta'
    const printCompanyLegalLine =
      companySettings.name && companySettings.name !== printCompanyName
        ? companySettings.name
        : 'Solucoes juridicas e previdenciarias'
    const printCompanyContactLine = [companySettings.document, companySettings.phone, companySettings.email].filter(Boolean).join(' | ')
    const printCompanyAddressLine = [
      companySettings.address,
      companySettings.city,
      companySettings.state,
      companySettings.zipCode,
    ].filter(Boolean).join(' - ')

    printWindow.document.write(`
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <title>Calculo - ${escapeHtml(calculation.clientName)}</title>
          <style>
            body { margin: 0; padding: 32px; color: #172033; font-family: Arial, sans-serif; }
            header { border-bottom: 3px solid #0b3b82; padding-bottom: 18px; display: flex; align-items: center; gap: 16px; }
            header img { width: 180px; height: auto; }
            h1 { margin: 24px 0 8px; font-size: 24px; }
            h2 { margin: 22px 0 10px; font-size: 18px; color: #0b3b82; }
            .meta, table { width: 100%; border-collapse: collapse; }
            .meta td, th, td { border: 1px solid #d9e1ec; padding: 10px; text-align: left; }
            th { background: #eef2f7; }
            .total { font-size: 20px; font-weight: 700; }
            footer { margin-top: 48px; color: #607086; font-size: 12px; }
          </style>
        </head>
        <body>
          <header>
            <img src="${printLogo}" alt="${escapeHtml(printCompanyName)}" />
            <div>
              <strong>${escapeHtml(printCompanyName)}</strong><br />
              <span>${escapeHtml(printCompanyLegalLine)}</span>
              ${printCompanyContactLine ? `<br /><span>${escapeHtml(printCompanyContactLine)}</span>` : ''}
              ${printCompanyAddressLine ? `<br /><span>${escapeHtml(printCompanyAddressLine)}</span>` : ''}
            </div>
          </header>
          <h1>Resumo do calculo</h1>
          <table class="meta">
            <tr><td>Cliente</td><td>${escapeHtml(calculation.clientName)}</td></tr>
            <tr><td>Tipo</td><td>${calculationKindLabel[calculation.kind]}</td></tr>
            <tr><td>Modelo</td><td>${calculationFormulaLabel[calculation.formula ?? 'livre']}</td></tr>
            <tr><td>Referencia</td><td>${escapeHtml(calculation.reference)}</td></tr>
            <tr><td>Data</td><td>${formatDateTime(calculation.createdAt)}</td></tr>
          </table>
          <h2>Valores</h2>
          <table>
            <tr><th>Principal</th><th>Correcao</th><th>Juros</th><th>Honorarios/Outros</th></tr>
            <tr><td>${money(calculation.principal)}</td><td>${money(calculation.correction)}</td><td>${money(calculation.interest)}</td><td>${money(calculation.fees)}</td></tr>
          </table>
          <p class="total">Total estimado: ${money(calculation.estimatedTotal)}</p>
          <h2>Descricao</h2>
          <p>${escapeHtml(calculation.description).replace(/\n/g, '<br />')}</p>
          <footer>Documento gerado pelo JusPrevConecta. Revise tecnicamente antes de protocolar ou enviar ao cliente.</footer>
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAccountMessage('')

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setAccountMessage('A confirmacao da nova senha nao confere.')
      return
    }

    const result = await apiRequest<{ ok: boolean; error?: string }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        userId: session?.id,
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      }),
    })

    if (!result?.ok) {
      setAccountMessage('Nao foi possivel alterar a senha. Confira a senha atual.')
      return
    }

    setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    setAccountMessage('Senha alterada com sucesso.')
    await refreshAuditLogs()
  }

  function openView(view: View) {
    if (canAccess(view, session)) {
      setActiveView(view)
    }
  }

  function applyTemplate(templateId: string) {
    const template = templates.find((item) => item.id === Number(templateId))

    if (template) {
      setDraft(template.body)
    }
  }

  async function updateSelectedConversation(update: Partial<Conversation>) {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === selectedConversation.id ? { ...conversation, ...update } : conversation,
      ),
    )

    const savedConversation = await apiRequest<Conversation>(`/api/conversations/${selectedConversation.id}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    })

    if (savedConversation) {
      replaceConversation(savedConversation)
    }

    refreshSyncQueueCount()
    await refreshAuditLogs()
  }

  function scheduleReturn() {
    updateSelectedConversation({
      status: 'retorno',
      scheduledAt: returnDateTime,
      nextAction: `Retorno em ${formatDateTime(returnDateTime)}`,
      lastUpdate: formatDateTime(new Date().toISOString()),
    })
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!draft.trim() || !selectedConversation) {
      return
    }

    const nextMessage: Message = {
      id: Date.now(),
      author: 'agent',
      text: draft.trim(),
      time: formatDateTime(new Date().toISOString()),
    }

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === selectedConversation.id
          ? {
              ...conversation,
              status: 'em_atendimento',
              lastUpdate: formatDateTime(new Date().toISOString()),
              messages: [...conversation.messages, nextMessage],
            }
          : conversation,
      ),
    )

    const savedConversation = await apiRequest<Conversation>(`/api/conversations/${selectedConversation.id}/messages`, {
      method: 'POST',
      body: JSON.stringify(nextMessage),
    })

    if (savedConversation) {
      replaceConversation(savedConversation)
    }

    setDraft('')
    refreshSyncQueueCount()
    await refreshAuditLogs()
  }

  if (!session) {
    return (
      <main className="login-screen">
        <form className="login-card" onSubmit={handleLogin}>
          <img className="login-logo" src="/logo-cropped.png" alt="JusPrevConecta" />
          <div>
            <p className="eyebrow">JusPrevConecta</p>
            <h1>Entrar no painel</h1>
          </div>
          <label>
            Email
            <input required type="email" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} />
          </label>
          <label>
            Senha
            <input
              required
              minLength={4}
              type="password"
              placeholder="Digite qualquer senha para o MVP"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
            />
          </label>
          {loginError && <div className="form-error">{loginError}</div>}
          <button className="primary-button" type="submit">Entrar</button>
          <small>Acesso inicial: admin@jusprevconecta.com / JusPrev@2026</small>
        </form>
      </main>
    )
  }

  const canUseSettings = settingsViews.some((view) => canAccess(view, session))
  const settingsIsActive = settingsViews.includes(activeView)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src="/logo-cropped.png" alt="JusPrevConecta" />
          <div>
            <strong>JusPrevConecta</strong>
            <small>Soluções jurídicas e previdenciárias</small>
          </div>
        </div>

        <nav className="main-nav" aria-label="Menu principal">
          <button className={activeView === 'inbox' ? 'active' : ''} type="button" onClick={() => openView('inbox')}><Inbox size={18} /> Inbox</button>
          {canAccess('contatos', session) && <button className={activeView === 'contatos' ? 'active' : ''} type="button" onClick={() => openView('contatos')}><UserRound size={18} /> Contatos</button>}
          {canAccess('modelos', session) && <button className={activeView === 'modelos' ? 'active' : ''} type="button" onClick={() => openView('modelos')}><MessageCircle size={18} /> Modelos</button>}
          {canAccess('disparos', session) && <button className={activeView === 'disparos' ? 'active' : ''} type="button" onClick={() => openView('disparos')}><Send size={18} /> Disparos</button>}
          {canAccess('documentos', session) && <button className={activeView === 'documentos' ? 'active' : ''} type="button" onClick={() => openView('documentos')}><FileText size={18} /> Documentos</button>}
          {canAccess('calculos', session) && <button className={activeView === 'calculos' ? 'active' : ''} type="button" onClick={() => openView('calculos')}><Calculator size={18} /> Calculos</button>}
          {canAccess('relatorios', session) && <button className={activeView === 'relatorios' ? 'active' : ''} type="button" onClick={() => openView('relatorios')}><PanelRightOpen size={18} /> Relatorios</button>}
          {canUseSettings && (
            <div className={`nav-group ${settingsIsActive ? 'active' : ''}`}>
              <button className="nav-group-toggle" type="button" onClick={() => setSettingsMenuOpen((current) => !current)}>
                <Settings size={18} /> Configuracao
              </button>
              {(settingsMenuOpen || settingsIsActive) && (
                <div className="nav-submenu">
                  {canAccess('usuarios', session) && <button className={activeView === 'usuarios' ? 'active' : ''} type="button" onClick={() => openView('usuarios')}><UserRound size={17} /> Usuarios</button>}
                  {canAccess('seguranca', session) && <button className={activeView === 'seguranca' ? 'active' : ''} type="button" onClick={() => openView('seguranca')}><ShieldCheck size={17} /> Seguranca</button>}
                  {canAccess('auditoria', session) && <button className={activeView === 'auditoria' ? 'active' : ''} type="button" onClick={() => openView('auditoria')}><History size={17} /> Auditoria</button>}
                  {canAccess('sincronizacao', session) && <button className={activeView === 'sincronizacao' ? 'active' : ''} type="button" onClick={() => openView('sincronizacao')}><History size={17} /> Sincronizacao</button>}
                  {canAccess('conta', session) && <button className={activeView === 'conta' ? 'active' : ''} type="button" onClick={() => openView('conta')}><KeyRound size={17} /> Conta</button>}
                </div>
              )}
            </div>
          )}
        </nav>

        <div className="sidebar-footer">
          <button type="button" onClick={handleLogout}><LogOut size={18} /> Sair</button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Painel operacional</p>
            <h1>{activeView === 'inbox' ? 'Atendimentos' : activeView === 'contatos' ? 'Contatos' : activeView === 'modelos' ? 'Respostas prontas' : activeView === 'disparos' ? 'Disparos' : activeView === 'documentos' ? 'Documentos' : activeView === 'calculos' ? 'Calculos' : activeView === 'usuarios' ? 'Usuarios' : activeView === 'seguranca' ? 'Seguranca' : activeView === 'auditoria' ? 'Auditoria' : activeView === 'sincronizacao' ? 'Sincronizacao' : activeView === 'conta' ? 'Minha conta' : 'Relatorios'}</h1>
            {activeView === 'inbox' && (
              <div className="status-line">
                <span className={`data-mode ${apiStatus}`}>{apiStatus === 'online' ? 'Banco conectado' : 'Modo local'}</span>
                <span className={`data-mode ${isOnline ? 'online' : 'local'}`}>{isOnline ? 'Internet ativa' : 'Offline'}</span>
                <button className="sync-pill" type="button" onClick={synchronizeOfflineQueue}>
                  {syncQueueCount > 0 ? `${syncQueueCount} pendente(s)` : 'Sincronizado'}
                </button>
                <span className="session-pill">{sessionRemaining}</span>
              </div>
            )}
            {syncMessage && <p className="sync-message">{syncMessage}</p>}
          </div>

          <div className="topbar-tools">
            <div className="datetime-card" aria-label="Data e hora do sistema">
              <Clock3 size={18} />
              <div>
                <span>Data e hora</span>
                <strong>{formatDateTime(currentNow.toISOString())}</strong>
              </div>
            </div>

            <label className="search-box">
              <Search size={18} />
              <input
                type="search"
                placeholder="Buscar cliente, telefone, email ou assunto"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>
          </div>
        </header>

        {registrationRequired && (
          <section className="registration-alert">
            <KeyRound size={18} />
            <div>
              <strong>Sistema aguardando chave de registro</strong>
              <span>Informe a chave em Configuracao &gt; Seguranca para liberar as operacoes e proteger o banco de dados.</span>
            </div>
          </section>
        )}

        {activeView === 'inbox' && (
          <section className="metrics" aria-label="Indicadores">
            {activeMetrics.map((metric) => {
              const Icon = metric.icon

              return (
                <article className="metric" key={metric.label}>
                  <Icon size={20} />
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </article>
              )
            })}
          </section>
        )}

        {activeView === 'inbox' && selectedConversation && (
          <section className="content-grid">
            <section className="inbox-panel" aria-label="Lista de conversas">
              <div className="panel-toolbar">
                <div className="segmented">
                  <button className={channelFilter === 'todos' ? 'active' : ''} type="button" onClick={() => setChannelFilter('todos')}>Todos</button>
                  <button className={channelFilter === 'whatsapp' ? 'active' : ''} type="button" onClick={() => setChannelFilter('whatsapp')}>WhatsApp</button>
                  <button className={channelFilter === 'email' ? 'active' : ''} type="button" onClick={() => setChannelFilter('email')}>Email</button>
                </div>

                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'todos' | Status)}>
                  <option value="todos">Todos os status</option>
                  <option value="novo">Novo</option>
                  <option value="em_atendimento">Em atendimento</option>
                  <option value="aguardando_cliente">Aguardando cliente</option>
                  <option value="retorno">Retorno</option>
                  <option value="concluido">Concluido</option>
                </select>
              </div>

              <div className="conversation-list">
                {filteredConversations.map((conversation) => (
                  <button
                    className={`conversation-card ${selectedConversation.id === conversation.id ? 'active' : ''}`}
                    key={conversation.id}
                    type="button"
                    onClick={() => setSelectedId(conversation.id)}
                  >
                    <div className="conversation-head">
                      <strong>{conversation.contact}</strong>
                      <span>{conversation.lastUpdate}</span>
                    </div>
                    <p>{conversation.subject}</p>
                    <div className="date-row">
                      <CalendarClock size={14} />
                      <span>{conversation.scheduledAt ? `Retorno: ${formatDateTime(conversation.scheduledAt)}` : `Criado: ${formatDateTime(conversation.createdAt)}`}</span>
                    </div>
                    <div className="conversation-meta">
                      <span className={`channel-pill ${conversation.channel}`}>
                        {conversation.channel === 'whatsapp' ? <MessageCircle size={14} /> : <Mail size={14} />}
                        {conversation.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}
                      </span>
                      <span className={`priority priority-${conversation.priority}`}>{priorityLabel[conversation.priority]}</span>
                    </div>
                  </button>
                ))}

                {filteredConversations.length === 0 && (
                  <div className="empty-state">Nenhuma conversa encontrada com esses filtros.</div>
                )}
              </div>
            </section>

            <section className="conversation-detail" aria-label="Detalhe do atendimento">
              <div className="detail-header">
                <div>
                  <div className="detail-title-row">
                    <h2>{selectedConversation.contact}</h2>
                    <span className={`status status-${selectedConversation.status}`}>{statusLabel[selectedConversation.status]}</span>
                  </div>
                  <p>{selectedConversation.subject}</p>
                </div>

                <div className="detail-actions">
                  <label className="compact-date">
                    Data e hora do retorno
                    <input type="datetime-local" value={returnDateTime} onChange={(event) => setReturnDateTime(event.target.value)} />
                  </label>
                  <button className="ghost-button" type="button" onClick={scheduleReturn}><CalendarClock size={17} /> Retorno</button>
                  <button className="primary-button" type="button" onClick={() => updateSelectedConversation({ status: 'concluido', nextAction: 'Atendimento concluido' })}><CheckCircle2 size={17} /> Concluir</button>
                  <button className="danger-button" type="button" onClick={() => deleteConversation(selectedConversation)}><Trash2 size={17} /> Excluir</button>
                </div>
              </div>

              <div className="message-stream">
                {selectedConversation.messages.map((message) => (
                  <div className={`message-bubble ${message.author}`} key={message.id}>
                    <p>{message.text}</p>
                    <span>{message.time}</span>
                  </div>
                ))}
              </div>

              <form className="reply-box" onSubmit={sendMessage}>
                <select defaultValue="" onChange={(event) => applyTemplate(event.target.value)}>
                  <option value="" disabled>Aplicar resposta pronta</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>{template.title}</option>
                  ))}
                </select>
                <textarea
                  placeholder="Escrever resposta ou observacao interna..."
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <div className="reply-actions">
                  <span>Responsavel: {selectedConversation.responsible}</span>
                  <button className="primary-button" type="submit" disabled={!draft.trim()}><Send size={17} /> Enviar</button>
                </div>
              </form>
            </section>

            <aside className="contact-panel" aria-label="Dados do contato">
              <div className="contact-avatar">{selectedConversation.contact.slice(0, 1)}</div>
              <h3>{selectedConversation.company}</h3>
              <dl>
                <div>
                  <dt>Telefone</dt>
                  <dd>{selectedConversation.phone}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{selectedConversation.email}</dd>
                </div>
                <div>
                  <dt>Canal</dt>
                  <dd>{selectedConversation.channel === 'whatsapp' ? 'WhatsApp Business' : 'Email'}</dd>
                </div>
                <div>
                  <dt>Criado em</dt>
                  <dd>{formatDateTime(selectedConversation.createdAt)}</dd>
                </div>
                <div>
                  <dt>Retorno agendado</dt>
                  <dd>{formatDateTime(selectedConversation.scheduledAt)}</dd>
                </div>
                <div>
                  <dt>Proxima acao</dt>
                  <dd>{selectedConversation.nextAction}</dd>
                </div>
              </dl>
            </aside>
          </section>
        )}

        {activeView === 'contatos' && (
          <section className="management-grid contacts-view">
            <form className="form-panel" onSubmit={addContact}>
              <h2>Novo contato</h2>
              <label>Nome<input required value={contactForm.contact} onChange={(event) => setContactForm({ ...contactForm, contact: event.target.value })} /></label>
              <label>Empresa<input value={contactForm.company} onChange={(event) => setContactForm({ ...contactForm, company: event.target.value })} /></label>
              <label>Telefone<input required value={contactForm.phone} onChange={(event) => setContactForm({ ...contactForm, phone: event.target.value })} /></label>
              <label>Email<input required type="email" value={contactForm.email} onChange={(event) => setContactForm({ ...contactForm, email: event.target.value })} /></label>
              <label>Canal
                <select value={contactForm.channel} onChange={(event) => setContactForm({ ...contactForm, channel: event.target.value as Channel })}>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                </select>
              </label>
              <label>Assunto<input value={contactForm.subject} onChange={(event) => setContactForm({ ...contactForm, subject: event.target.value })} /></label>
              <label>Data e hora do retorno<input type="datetime-local" value={contactForm.scheduledAt} onChange={(event) => setContactForm({ ...contactForm, scheduledAt: event.target.value })} /></label>
              <button className="primary-button" type="submit"><Plus size={17} /> Salvar contato</button>
            </form>

            <div className="table-panel">
              <h2>Contatos salvos</h2>
              <div className="contact-list">
                {filteredConversations.map((conversation) => (
                  <article className="contact-row" key={conversation.id}>
                    <strong>{conversation.contact}</strong>
                    <span>{conversation.phone}</span>
                    <span>{conversation.email}</span>
                    <span>{conversation.scheduledAt ? formatDateTime(conversation.scheduledAt) : 'Sem retorno'}</span>
                    <button type="button" onClick={() => { setSelectedId(conversation.id); setActiveView('inbox') }}>Abrir</button>
                    <button className="danger-button compact" type="button" onClick={() => deleteConversation(conversation)}><Trash2 size={15} /> Excluir</button>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeView === 'modelos' && (
          <section className="management-grid">
            <form className="form-panel" onSubmit={addTemplate}>
              <h2>Nova resposta pronta</h2>
              <label>Titulo<input required value={templateForm.title} onChange={(event) => setTemplateForm({ ...templateForm, title: event.target.value })} /></label>
              <label>Mensagem<textarea required value={templateForm.body} onChange={(event) => setTemplateForm({ ...templateForm, body: event.target.value })} /></label>
              <button className="primary-button" type="submit"><Save size={17} /> Salvar modelo</button>
            </form>

            <div className="table-panel">
              <h2>Modelos salvos</h2>
              <div className="template-list">
                {templates.map((template) => (
                  <article className="template-card" key={template.id}>
                    <strong>{template.title}</strong>
                    <p>{template.body}</p>
                    <button className="danger-button compact" type="button" onClick={() => deleteTemplate(template)}><Trash2 size={15} /> Excluir</button>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeView === 'disparos' && (
          <section className="management-grid broadcast-grid">
            <form className="form-panel broadcast-form" onSubmit={addBroadcast}>
              <div className={`broadcast-form-scroll ${broadcastForm.channel === 'email' ? 'email-mode' : 'whatsapp-mode'}`}>
                <h2>Novo disparo</h2>
                <div className="integration-status">
                  <span className={`status ${integrationStatus?.whatsapp ? 'status-concluido' : 'status-aguardando_cliente'}`}>WhatsApp {integrationStatus?.whatsapp ? 'ativo' : 'pendente'}</span>
                  <span className={`status ${integrationStatus?.email ? 'status-concluido' : 'status-aguardando_cliente'}`}>E-mail {integrationStatus?.email ? 'ativo' : 'pendente'}</span>
                </div>
                <label className="broadcast-field channel">Canal
                  <select value={broadcastForm.channel} onChange={(event) => setBroadcastForm({ ...broadcastForm, channel: event.target.value as Channel })}>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="email">Email</option>
                  </select>
                </label>
                {broadcastForm.channel === 'email' && (
                  <label className="broadcast-field account">Conta de envio
                    <select value={broadcastForm.senderAccount} onChange={(event) => setBroadcastForm({ ...broadcastForm, senderAccount: event.target.value })}>
                      <option value="">Conta padrao configurada</option>
                      {(integrationStatus?.emailAccounts ?? []).map((account) => (
                        <option key={account.id} value={account.id}>{account.label} - {account.from}</option>
                      ))}
                    </select>
                  </label>
                )}
                {broadcastForm.channel === 'email' && !integrationStatus?.email && (
                  <div className="form-warning broadcast-email-warning">
                    <span>SMTP ainda nao configurado.</span>
                    <button className="ghost-button compact" type="button" onClick={() => openView('seguranca')}>Configurar e-mail</button>
                  </div>
                )}
                {broadcastForm.channel === 'whatsapp' && (
                  <>
                    <label className="broadcast-field meta-template">Modelo Meta
                      <input value={broadcastForm.whatsappTemplateName} onChange={(event) => setBroadcastForm({ ...broadcastForm, whatsappTemplateName: event.target.value })} placeholder="modelo_aprovado" />
                    </label>
                    <label className="broadcast-field template-language">Idioma
                      <input value={broadcastForm.whatsappTemplateLanguage} onChange={(event) => setBroadcastForm({ ...broadcastForm, whatsappTemplateLanguage: event.target.value })} placeholder="pt_BR" />
                    </label>
                    {broadcastForm.whatsappTemplateName.trim().toLowerCase() === 'hello_world' && (
                      <p className="form-warning">O modelo hello_world so funciona com o numero publico de teste da Meta.</p>
                    )}
                  </>
                )}
                <label className="broadcast-field campaign">Nome da campanha<input required value={broadcastForm.name} onChange={(event) => setBroadcastForm({ ...broadcastForm, name: event.target.value })} /></label>
                {broadcastForm.channel === 'email' && (
                  <label className="broadcast-field subject">Assunto<input required value={broadcastForm.subject} onChange={(event) => setBroadcastForm({ ...broadcastForm, subject: event.target.value })} placeholder="Obrigatorio para e-mail" /></label>
                )}
                <label className="broadcast-field text-template">Modelo de mensagem
                  <select defaultValue="" onChange={(event) => loadBroadcastTextTemplate(event.target.value)}>
                    <option value="">Escolher arquivo .txt</option>
                    {messageTextTemplates.map((template) => (
                      <option key={template.path} value={template.path}>{template.label}</option>
                    ))}
                  </select>
                </label>
                <label className="broadcast-field message">Mensagem<textarea required value={broadcastForm.message} onChange={(event) => setBroadcastForm({ ...broadcastForm, message: event.target.value })} /></label>
                {isTechnicalWhatsAppPayload(broadcastForm.message) && (
                  <p className="form-warning">Esse campo deve receber apenas o texto para o cliente. Nao cole comando curl, token ou cabecalho Authorization.</p>
                )}
                <label className="broadcast-field recipients">{broadcastForm.channel === 'whatsapp' ? 'Telefones dos destinatarios' : 'E-mails dos destinatarios'}
                  <textarea
                    className="recipients-field"
                    required
                    value={broadcastForm.recipients}
                    onChange={(event) => setBroadcastForm({ ...broadcastForm, recipients: event.target.value })}
                    placeholder={broadcastForm.channel === 'whatsapp' ? '71999999999\n11917803700' : 'cliente@email.com\noutro@email.com'}
                  />
                </label>
                {broadcastForm.channel === 'whatsapp' && (
                  <p className="form-note compact recipients-note">DDD + numero. O sistema acrescenta 55 no envio.</p>
                )}
              </div>
              <div className="broadcast-form-actions">
                <label>Agendar para<input type="datetime-local" value={broadcastForm.scheduledAt} onChange={(event) => setBroadcastForm({ ...broadcastForm, scheduledAt: event.target.value })} /></label>
                <button className="primary-button" type="submit"><Send size={17} /> Preparar disparo</button>
                {broadcastMessage && <div className="form-info">{broadcastMessage}</div>}
              </div>
            </form>

            <div className="table-panel">
              <div className="panel-head">
                <div>
                  <h2>Fila de disparos</h2>
                </div>
              </div>

              <div className="broadcast-list">
                {broadcasts.length > 0 && (
                  <div className="broadcast-table-head" aria-hidden="true">
                    <span>Canal</span>
                    <span>Campanha</span>
                    <span>Dest.</span>
                    <span>Envios</span>
                    <span>Status</span>
                    <span>Data</span>
                    <span>Acoes</span>
                  </div>
                )}
                {broadcasts.map((broadcast) => (
                  <article className="broadcast-card" key={broadcast.id}>
                    <span className={`channel-pill ${broadcast.channel}`}>{broadcast.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}</span>
                    <div className="broadcast-title-cell">
                      <strong>{broadcast.name}</strong>
                      <span>{broadcast.channel === 'email' ? broadcast.subject || 'Sem assunto' : broadcast.whatsappTemplateName ? `Modelo: ${broadcast.whatsappTemplateName}` : 'Sem modelo Meta'}</span>
                    </div>
                    <span>{broadcast.recipientCount}</span>
                    <span>{broadcast.sentCount ?? 0}/{broadcast.failedCount ?? 0}</span>
                    <span className="broadcast-status-cell">{broadcastStatusLabel[broadcast.status]}</span>
                    <span>{broadcast.scheduledAt ? formatDateTime(broadcast.scheduledAt) : formatDateTime(broadcast.createdAt)}</span>
                    <div className="broadcast-actions">
                      <button className="primary-button" type="button" onClick={() => sendBroadcastNow(broadcast)} disabled={broadcast.status === 'enviado'}>
                        <Send size={17} /> {broadcast.status === 'enviado' ? 'API ok' : 'Disparar'}
                      </button>
                      <button className="danger-button compact" type="button" onClick={() => deleteBroadcast(broadcast)}><Trash2 size={15} /> Excluir</button>
                    </div>
                  </article>
                ))}

                {broadcasts.length === 0 && (
                  <div className="empty-state">Nenhum disparo preparado ainda.</div>
                )}
              </div>
            </div>
          </section>
        )}

        {activeView === 'documentos' && (
          <section className="letterhead-view">
            <form className="form-panel letterhead-form no-print">
              <h2>Papel timbrado</h2>
              <p className="panel-note">Monte o documento e use imprimir para gerar papel ou salvar em PDF.</p>
              <div className="letterhead-field-grid">
                <label>Titulo<input value={letterheadForm.title} onChange={(event) => setLetterheadForm({ ...letterheadForm, title: event.target.value })} /></label>
                <label>Referencia<input value={letterheadForm.reference} onChange={(event) => setLetterheadForm({ ...letterheadForm, reference: event.target.value })} placeholder="Processo, NB, atendimento..." /></label>
              </div>
              <label>Destinatario<input value={letterheadForm.recipient} onChange={(event) => setLetterheadForm({ ...letterheadForm, recipient: event.target.value })} placeholder="Cliente, orgao, vara..." /></label>
              <label>E-mail para envio<input type="email" value={letterheadForm.recipientEmail || ''} onChange={(event) => setLetterheadForm({ ...letterheadForm, recipientEmail: event.target.value })} placeholder="cliente@email.com" /></label>
              <label>Conteudo<textarea value={letterheadForm.body} onChange={(event) => setLetterheadForm({ ...letterheadForm, body: event.target.value })} /></label>
              <div className="money-grid">
                <label>Assinante<input value={letterheadForm.signer} onChange={(event) => setLetterheadForm({ ...letterheadForm, signer: event.target.value })} /></label>
                <label>Cargo<input value={letterheadForm.signerRole} onChange={(event) => setLetterheadForm({ ...letterheadForm, signerRole: event.target.value })} /></label>
              </div>
              {documentMessage && <div className="form-info">{documentMessage}</div>}
              <div className="button-row">
                <button className="ghost-button" type="button" onClick={saveLetterheadDraft}><Save size={17} /> Cadastrar documento</button>
                <button className="primary-button" type="button" onClick={printLetterhead}><FileText size={17} /> Imprimir/PDF</button>
                <button className="ghost-button" type="button" onClick={sendLetterheadEmail}><Mail size={17} /> Enviar por e-mail</button>
              </div>
            </form>

            <article className="letterhead-page" aria-label="Previa do papel timbrado">
              <header className="letterhead-header">
                <img src={companyLogo} alt={companyName} />
                <div>
                  <strong>{companyName}</strong>
                  <span>{companyLegalLine}</span>
                  {companyContactLine && <span>{companyContactLine}</span>}
                  {companyAddressLine && <span>{companyAddressLine}</span>}
                </div>
              </header>
              <img className="letterhead-watermark" src={companyLogo} alt="" aria-hidden="true" />
              <div className="letterhead-meta">
                <span>Data: {formatDate(new Date().toISOString())}</span>
                {letterheadForm.recipient && <span>Destinatario: {letterheadForm.recipient}</span>}
                {letterheadForm.reference && <span>Referencia: {letterheadForm.reference}</span>}
              </div>
              <h2>{letterheadForm.title}</h2>
              <div className="letterhead-body">
                {letterheadForm.body.split('\n').map((paragraph, index) => (
                  <p key={`${paragraph}-${index}`}>{paragraph || '\u00A0'}</p>
                ))}
              </div>
              <footer className="letterhead-signature">
                <span>{letterheadForm.signer}</span>
                <small>{letterheadForm.signerRole}</small>
              </footer>
              {companyFooterLine && (
                <footer className="letterhead-footer">
                  {companyFooterLine}
                </footer>
              )}
            </article>
          </section>
        )}

        {activeView === 'calculos' && (
          <section className="management-grid calcs-view">
            <form className="form-panel" onSubmit={addCalculation}>
              <h2>Novo calculo assistido</h2>
              <label>Tipo
                <select value={calculationForm.kind} onChange={(event) => setCalculationForm({ ...calculationForm, kind: event.target.value as CalculationKind })}>
                  <option value="judicial">Judicial</option>
                  <option value="previdenciario">Previdenciario</option>
                </select>
              </label>
              <label>Modelo de calculo
                <select value={calculationForm.formula} onChange={(event) => setCalculationForm({ ...calculationForm, formula: event.target.value as CalculationFormula })}>
                  <option value="livre">Livre / revisao manual</option>
                  <option value="trabalhista">Trabalhista assistido</option>
                  <option value="previdenciario_atrasados">Previdenciario - atrasados</option>
                </select>
              </label>
              <label>Cliente<input required value={calculationForm.clientName} onChange={(event) => setCalculationForm({ ...calculationForm, clientName: event.target.value })} /></label>
              <label>Referencia<input required placeholder="Processo, NB, RMI, revisao..." value={calculationForm.reference} onChange={(event) => setCalculationForm({ ...calculationForm, reference: event.target.value })} /></label>
              <label>Descricao<textarea required value={calculationForm.description} onChange={(event) => setCalculationForm({ ...calculationForm, description: event.target.value })} /></label>
              <div className="money-grid">
                <label>Principal<input type="number" min="0" step="0.01" value={calculationForm.principal} onChange={(event) => setCalculationForm({ ...calculationForm, principal: event.target.value })} /></label>
                <label>Correcao<input type="number" min="0" step="0.01" value={calculationForm.correction} onChange={(event) => setCalculationForm({ ...calculationForm, correction: event.target.value })} /></label>
                <label>Juros<input type="number" min="0" step="0.01" value={calculationForm.interest} onChange={(event) => setCalculationForm({ ...calculationForm, interest: event.target.value })} /></label>
                <label>Honorarios/Outros<input type="number" min="0" step="0.01" value={calculationForm.fees} onChange={(event) => setCalculationForm({ ...calculationForm, fees: event.target.value })} /></label>
              </div>
              <div className="button-row">
                <button className="primary-button" type="submit"><Calculator size={17} /> Salvar calculo</button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => setCalculationForm({ kind: 'judicial', formula: 'livre', clientName: '', reference: '', description: '', principal: '', correction: '', interest: '', fees: '' })}
                >
                  Limpar
                </button>
              </div>
            </form>

            <div className="table-panel">
              <h2>Calculos salvos</h2>
              <div className="calc-list">
                {calculations.map((calculation) => (
                  <article className="calc-card" key={calculation.id}>
                    <div>
                      <span className={`channel-pill ${calculation.kind === 'judicial' ? 'email' : 'whatsapp'}`}>{calculationKindLabel[calculation.kind]}</span>
                      <span className="calc-formula">{calculationFormulaLabel[calculation.formula ?? 'livre']}</span>
                      <strong>{calculation.clientName}</strong>
                      <p>{calculation.reference}</p>
                    </div>
                    <div className="calc-values">
                      <span>Principal: {calculation.principal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                      <span>Correcao: {calculation.correction.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                      <span>Juros: {calculation.interest.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                      <strong>Total estimado: {calculation.estimatedTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
                    </div>
                    <div className="calc-footer">
                      <span className="status status-retorno">Revisao tecnica</span>
                      <span>{formatDateTime(calculation.createdAt)}</span>
                      <div className="calc-actions">
                        <button className="ghost-button compact" type="button" onClick={() => printCalculation(calculation)}><FileText size={15} /> Imprimir/PDF</button>
                        <button className="danger-button compact" type="button" onClick={() => deleteCalculation(calculation)}><Trash2 size={15} /> Excluir</button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeView === 'usuarios' && (
          <section className="management-grid">
            <form className="form-panel" onSubmit={saveUser}>
              <h2>{editingUserId ? 'Editar usuario' : 'Novo usuario'}</h2>
              <label>Nome<input required value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} /></label>
              <label>Email<input required type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} /></label>
              <label>Senha<input required={!editingUserId} minLength={editingUserId ? undefined : 6} type="password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} placeholder={editingUserId ? 'Deixe em branco para manter' : 'Minimo 6 caracteres'} /></label>
              <label>Perfil
                <select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value })}>
                  <option value="admin">Administrador</option>
                  <option value="atendente">Atendente</option>
                  <option value="advogado">Advogado</option>
                  <option value="calculista">Calculista</option>
                  <option value="sdr">SDR</option>
                </select>
              </label>
              {userMessage && <div className="form-info">{userMessage}</div>}
              <button className="primary-button" type="submit">{editingUserId ? <Save size={17} /> : <Plus size={17} />} {editingUserId ? 'Atualizar usuario' : 'Salvar usuario'}</button>
              {editingUserId && <button className="ghost-button" type="button" onClick={cancelEditUser}>Cancelar edicao</button>}
            </form>

            <div className="table-panel">
              <h2>Equipe cadastrada</h2>
              <div className="user-list">
                {users.map((user) => (
                  <article className="user-row" key={user.id}>
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                    <span className="status status-em_atendimento">{user.role}</span>
                    <span>{formatDateTime(user.createdAt)}</span>
                    <button className="ghost-button" type="button" onClick={() => startEditUser(user)}>Editar</button>
                    <button className="danger-button compact" type="button" onClick={() => deleteUser(user)} disabled={session?.id === user.id}><Trash2 size={15} /> Excluir</button>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeView === 'seguranca' && (
          <section className="security-view">
            <div className="security-grid">
              <form className="form-panel company-settings-panel" onSubmit={saveCompanySettingsProfile}>
                <div className="panel-head">
                  <div>
                    <h2>Cadastro da empresa</h2>
                    <p>Dados usados no sistema, papel timbrado, impressao e PDFs.</p>
                  </div>
                </div>

                <div className="company-logo-tools">
                  <img className="company-logo-preview" src={companyLogo} alt={companyName} />
                  <div>
                    <label className="file-picker">
                      <Download size={16} /> Escolher logo
                      <input type="file" accept="image/*" onChange={handleCompanyLogoUpload} />
                    </label>
                    {companySettings.logoDataUrl && (
                      <button className="ghost-button compact" type="button" onClick={removeCompanyLogo}>Remover logo</button>
                    )}
                    <small>Imagem ate 1,5 MB. Ela aparece nos documentos impressos e PDFs.</small>
                  </div>
                </div>

                <div className="money-grid company-fields-grid">
                  <label>Razao social<input value={companySettings.name} onChange={(event) => setCompanySettings({ ...companySettings, name: event.target.value })} /></label>
                  <label>Nome fantasia<input value={companySettings.tradeName} onChange={(event) => setCompanySettings({ ...companySettings, tradeName: event.target.value })} /></label>
                  <label>CNPJ/CPF<input value={companySettings.document} onChange={(event) => setCompanySettings({ ...companySettings, document: event.target.value })} /></label>
                  <label>Responsavel<input value={companySettings.responsible} onChange={(event) => setCompanySettings({ ...companySettings, responsible: event.target.value })} /></label>
                  <label>Inscricao estadual<input value={companySettings.stateRegistration} onChange={(event) => setCompanySettings({ ...companySettings, stateRegistration: event.target.value })} /></label>
                  <label>Inscricao municipal<input value={companySettings.municipalRegistration} onChange={(event) => setCompanySettings({ ...companySettings, municipalRegistration: event.target.value })} /></label>
                  <label>Telefone<input value={companySettings.phone} onChange={(event) => setCompanySettings({ ...companySettings, phone: event.target.value })} /></label>
                  <label>WhatsApp<input value={companySettings.whatsapp} onChange={(event) => setCompanySettings({ ...companySettings, whatsapp: event.target.value })} /></label>
                  <label>E-mail<input type="email" value={companySettings.email} onChange={(event) => setCompanySettings({ ...companySettings, email: event.target.value })} /></label>
                  <label>Site<input value={companySettings.website} onChange={(event) => setCompanySettings({ ...companySettings, website: event.target.value })} /></label>
                  <label>Endereco<input value={companySettings.address} onChange={(event) => setCompanySettings({ ...companySettings, address: event.target.value })} /></label>
                  <label>Cidade<input value={companySettings.city} onChange={(event) => setCompanySettings({ ...companySettings, city: event.target.value })} /></label>
                  <label>UF<input maxLength={2} value={companySettings.state} onChange={(event) => setCompanySettings({ ...companySettings, state: event.target.value.toUpperCase() })} /></label>
                  <label>CEP<input value={companySettings.zipCode} onChange={(event) => setCompanySettings({ ...companySettings, zipCode: event.target.value })} /></label>
                </div>

                {companySettingsMessage && <div className="form-info">{companySettingsMessage}</div>}
                <button className="primary-button" type="submit"><Save size={17} /> Salvar cadastro da empresa</button>
              </form>

              <form className="form-panel" onSubmit={submitRegistrationKey}>
                <h2>Chave de registro</h2>
                <p className="panel-note">
                  A chave ativa esta instalacao do JusPrevConecta. Ela fica validada por segredo no servidor e nao e salva em texto aberto.
                </p>
                <div className="status-stack">
                  <span className={`status ${systemStatus?.registration.registered ? 'status-concluido' : 'status-aguardando_cliente'}`}>
                    {systemStatus?.registration.registered ? 'Sistema registrado' : 'Registro pendente'}
                  </span>
                  {systemStatus?.registration.fingerprint && <span>Fingerprint: {systemStatus.registration.fingerprint}</span>}
                  {systemStatus?.registration.registeredAt && <span>Registrado em: {formatDateTime(systemStatus.registration.registeredAt)}</span>}
                </div>
                <label>Chave
                  <input
                    required
                    type="password"
                    value={registrationKey}
                    onChange={(event) => setRegistrationKey(event.target.value)}
                    placeholder="Digite a chave de registro"
                  />
                </label>
                {securityMessage && <div className="form-info">{securityMessage}</div>}
                <button className="primary-button" type="submit"><KeyRound size={17} /> Registrar sistema</button>
              </form>

              <form className="form-panel" onSubmit={addEmailAccountToSettings}>
                <h2>Contas de e-mail</h2>
                <p className="panel-note">Cadastre SMTP para disparos de e-mail. A senha fica criptografada no banco.</p>
                <div className="money-grid">
                  <label>ID da conta<input required value={emailAccountForm.id} onChange={(event) => setEmailAccountForm({ ...emailAccountForm, id: event.target.value })} placeholder="atendimento" /></label>
                  <label>Nome visivel<input required value={emailAccountForm.label} onChange={(event) => setEmailAccountForm({ ...emailAccountForm, label: event.target.value })} placeholder="Atendimento" /></label>
                </div>
                <div className="money-grid">
                  <label>SMTP host<input required value={emailAccountForm.host} onChange={(event) => setEmailAccountForm({ ...emailAccountForm, host: event.target.value })} placeholder="smtp.gmail.com" /></label>
                  <label>Porta<input required type="number" value={emailAccountForm.port} onChange={(event) => setEmailAccountForm({ ...emailAccountForm, port: Number(event.target.value) })} /></label>
                </div>
                <label className="checkbox-row">
                  <input type="checkbox" checked={emailAccountForm.secure} onChange={(event) => setEmailAccountForm({ ...emailAccountForm, secure: event.target.checked, port: event.target.checked ? 465 : 587 })} />
                  Usar SSL direto
                </label>
                <label>Usuario SMTP<input required type="email" value={emailAccountForm.user} onChange={(event) => setEmailAccountForm({ ...emailAccountForm, user: event.target.value, from: emailAccountForm.from || event.target.value })} placeholder="seuemail@gmail.com" /></label>
                <label>Remetente<input required value={emailAccountForm.from} onChange={(event) => setEmailAccountForm({ ...emailAccountForm, from: event.target.value })} placeholder="JusPrevConecta <seuemail@gmail.com>" /></label>
                <label>Senha de app SMTP<input required type="password" value={emailAccountForm.pass ?? ''} onChange={(event) => setEmailAccountForm({ ...emailAccountForm, pass: event.target.value })} placeholder="Senha de app do Gmail ou SMTP" /></label>
                <button className="ghost-button" type="submit"><Plus size={17} /> Adicionar conta</button>

                <div className="email-account-list">
                  {emailSettings.accounts.map((account) => (
                    <article className="email-account-row" key={account.id}>
                      <div>
                        <strong>{account.label}</strong>
                        <span>{account.from}</span>
                        <small>{account.host}:{account.port} {account.secure ? 'SSL' : 'TLS'}</small>
                      </div>
                      <button className="danger-button compact" type="button" onClick={() => removeEmailAccountFromSettings(account.id)}><Trash2 size={15} /> Excluir</button>
                    </article>
                  ))}
                  {emailSettings.accounts.length === 0 && <div className="empty-state">Nenhuma conta SMTP cadastrada no sistema.</div>}
                </div>

                {emailSettingsMessage && <div className="form-info">{emailSettingsMessage}</div>}
                <button className="primary-button" type="button" onClick={saveEmailAccountSettings}><Save size={17} /> Salvar configuracao</button>
              </form>

              <div className="table-panel">
                <div className="panel-head">
                  <div>
                    <h2>Banco de dados</h2>
                    <p>Diagnostico de conexao e gravacao em producao.</p>
                  </div>
                  <button className="ghost-button" type="button" onClick={refreshSystemStatus}><ShieldCheck size={17} /> Verificar</button>
                </div>

                <div className="diagnostic-grid">
                  <article className="diagnostic-card">
                    <strong>{systemStatus?.database.ok ? 'Conectado' : 'Nao verificado'}</strong>
                    <span>{systemStatus?.database.provider ?? 'Aguardando verificacao'}</span>
                  </article>
                  <article className="diagnostic-card">
                    <strong>{systemStatus?.counts.conversations ?? conversations.length}</strong>
                    <span>Atendimentos salvos</span>
                  </article>
                  <article className="diagnostic-card">
                    <strong>{systemStatus?.counts.messages ?? 0}</strong>
                    <span>Mensagens salvas</span>
                  </article>
                  <article className="diagnostic-card">
                    <strong>{systemStatus?.counts.templates ?? templates.length}</strong>
                    <span>Modelos salvos</span>
                  </article>
                  <article className="diagnostic-card">
                    <strong>{systemStatus?.counts.calculations ?? calculations.length}</strong>
                    <span>Calculos salvos</span>
                  </article>
                  <article className="diagnostic-card">
                    <strong>{systemStatus?.counts.broadcasts ?? broadcasts.length}</strong>
                    <span>Disparos salvos</span>
                  </article>
                  <article className="diagnostic-card">
                    <strong>{systemStatus?.counts.auditLogs ?? auditLogs.length}</strong>
                    <span>Eventos auditados</span>
                  </article>
                </div>

                <div className="security-checklist">
                  <div><ShieldCheck size={18} /><span>Rotas protegidas por token de sessao.</span></div>
                  <div><ShieldCheck size={18} /><span>Usuarios e auditoria restritos a administradores.</span></div>
                  <div><ShieldCheck size={18} /><span>Senhas com hash PBKDF2 e sal individual.</span></div>
                  <div><ShieldCheck size={18} /><span>Respostas da API marcadas como no-store.</span></div>
                  <div><ShieldCheck size={18} /><span>Atualizacao remota: execute <code>npm run remote:update</code> no computador de manutencao.</span></div>
                  <div><ShieldCheck size={18} /><span>Impressao: o navegador usa a janela de impressao do Windows e a impressora padrao configurada.</span></div>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeView === 'auditoria' && (
          <section className="audit-panel">
            <div className="audit-header">
              <div>
                <h2>Eventos recentes</h2>
                <p>Registro operacional de acessos e alteracoes importantes.</p>
              </div>
              <button className="ghost-button" type="button" onClick={refreshAuditLogs}><History size={17} /> Atualizar</button>
            </div>

            <div className="audit-filters">
              <label>Acao
                <select value={auditFilters.action} onChange={(event) => setAuditFilters({ ...auditFilters, action: event.target.value })}>
                  <option value="">Todas</option>
                  {auditActions.map((action) => (
                    <option key={action} value={action}>{action}</option>
                  ))}
                </select>
              </label>
              <label>Usuario
                <input
                  type="search"
                  placeholder="email do usuario"
                  value={auditFilters.userEmail}
                  onChange={(event) => setAuditFilters({ ...auditFilters, userEmail: event.target.value })}
                />
              </label>
              <label>De
                <input type="date" value={auditFilters.dateFrom} onChange={(event) => setAuditFilters({ ...auditFilters, dateFrom: event.target.value })} />
              </label>
              <label>Ate
                <input type="date" value={auditFilters.dateTo} onChange={(event) => setAuditFilters({ ...auditFilters, dateTo: event.target.value })} />
              </label>
              <button className="ghost-button" type="button" onClick={() => setAuditFilters({ action: '', userEmail: '', dateFrom: '', dateTo: '' })}>Limpar</button>
            </div>

            <div className="audit-list">
              {auditLogs.map((log) => (
                <article className="audit-row" key={log.id}>
                  <div>
                    <strong>{log.summary}</strong>
                    <span>{log.userName || 'Sistema'} {log.userEmail ? `- ${log.userEmail}` : ''}</span>
                  </div>
                  <span className="status status-em_atendimento">{log.action}</span>
                  <span>{log.entity}{log.entityId ? ` #${log.entityId}` : ''}</span>
                  <span>{formatDateTime(log.createdAt)}</span>
                </article>
              ))}

              {auditLogs.length === 0 && (
                <div className="empty-state">Nenhum evento de auditoria registrado ainda.</div>
              )}
            </div>
          </section>
        )}

        {activeView === 'sincronizacao' && (
          <section className="sync-view">
            <div className="report-toolbar">
              <div>
                <h2>Banco offline desta maquina</h2>
                <p>Fila local vinculada ao usuario {session.email}. Quando a internet volta, o sistema sincroniza automaticamente.</p>
              </div>
              <button className="primary-button" type="button" onClick={synchronizeOfflineQueue}><History size={17} /> Sincronizar agora</button>
            </div>

            <div className="diagnostic-grid">
              <article className="diagnostic-card">
                <strong>{isOnline ? 'Online' : 'Offline'}</strong>
                <span>Status da internet</span>
              </article>
              <article className="diagnostic-card">
                <strong>{apiStatus === 'online' ? 'Conectado' : 'Local'}</strong>
                <span>Comunicacao com banco</span>
              </article>
              <article className="diagnostic-card">
                <strong>{pendingSyncItems.length}</strong>
                <span>Acoes pendentes</span>
              </article>
              <article className="diagnostic-card">
                <strong>{session.email}</strong>
                <span>Usuario da fila local</span>
              </article>
            </div>

            <div className="table-panel">
              <div className="panel-head">
                <div>
                  <h2>Pendencias de sincronizacao</h2>
                  <p>Registros criados ou alterados localmente quando a API nao respondeu.</p>
                </div>
              </div>

              <div className="sync-list">
                {pendingSyncItems.map((item) => (
                  <article className="sync-row" key={item.id}>
                    <div>
                      <strong>{item.method} {item.path}</strong>
                      <span>Criado em {formatDateTime(item.createdAt)} - tentativas: {item.attempts}</span>
                      {item.lastError && <span>Ultimo erro: {redactSensitiveText(item.lastError)}</span>}
                    </div>
                    <button className="ghost-button" type="button" onClick={() => discardPendingSyncItem(item.id)}>Descartar</button>
                  </article>
                ))}

                {pendingSyncItems.length === 0 && (
                  <div className="empty-state">Nenhuma pendencia local. Esta maquina esta sincronizada.</div>
                )}
              </div>
            </div>
          </section>
        )}

        {activeView === 'conta' && (
          <section className="management-grid">
            <div className="form-panel">
              <h2>Dados do acesso</h2>
              <dl>
                <div>
                  <dt>Nome</dt>
                  <dd>{session.name}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{session.email}</dd>
                </div>
                <div>
                  <dt>Perfil</dt>
                  <dd>{session.role}</dd>
                </div>
              </dl>
            </div>

            <form className="form-panel" onSubmit={changePassword}>
              <h2>Alterar senha</h2>
              <label>Senha atual<input required type="password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} /></label>
              <label>Nova senha<input required minLength={6} type="password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} /></label>
              <label>Confirmar nova senha<input required minLength={6} type="password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })} /></label>
              {accountMessage && <div className="form-info">{accountMessage}</div>}
              <button className="primary-button" type="submit"><KeyRound size={17} /> Alterar senha</button>
            </form>
          </section>
        )}

        {activeView === 'relatorios' && (
          <section className="reports-view">
            <div className="report-toolbar">
              <div>
                <h2>Resumo executivo</h2>
                <p>Indicadores atualizados com os dados salvos no banco e no painel.</p>
              </div>
              <div className="report-actions">
                <label className="report-kind-picker">
                  Relatorio
                  <select value={reportKind} onChange={(event) => setReportKind(event.target.value as ReportKind)}>
                    <option value="completo">Completo</option>
                    <option value="atendimentos">Atendimentos</option>
                    <option value="agenda">Agenda e produtividade</option>
                    <option value="calculos">Calculos</option>
                    <option value="disparos">Disparos</option>
                    <option value="seguranca">Seguranca e auditoria</option>
                  </select>
                </label>
                <button className="primary-button" type="button" onClick={printReports}><FileText size={17} /> Imprimir/PDF</button>
                <button className="ghost-button" type="button" onClick={exportReportsCsv}><Download size={17} /> Exportar CSV</button>
              </div>
            </div>

            <div className="report-grid">
              <article className="report-card"><strong>{reportData.totalConversations}</strong><span>Atendimentos registrados</span></article>
              <article className="report-card"><strong>{reportData.openConversations}</strong><span>Atendimentos abertos</span></article>
              <article className="report-card"><strong>{reportData.returnsToday}</strong><span>Retornos para hoje</span></article>
              <article className="report-card warning"><strong>{reportData.overdueReturns}</strong><span>Retornos em atraso</span></article>
              <article className="report-card"><strong>{percent(reportData.concludedConversations, reportData.totalConversations)}%</strong><span>Taxa de conclusao</span></article>
            </div>

            <div className="report-panels">
              <article className="report-panel">
                <div className="panel-head compact">
                  <div>
                    <h2>Operacao de atendimento</h2>
                    <p>Resumo por status e canal de entrada.</p>
                  </div>
                  <FileText size={20} />
                </div>
                <div className="report-bars">
                  {reportData.statusRows.map((row) => (
                    <div className="report-bar-row" key={row.label}>
                      <span>{row.label}</span>
                      <div className="report-bar-track"><div style={{ width: `${row.percent}%` }} /></div>
                      <strong>{row.count}</strong>
                    </div>
                  ))}
                </div>
                <div className="report-split">
                  {reportData.channelRows.map((row) => (
                    <div key={row.label}>
                      <span>{row.label}</span>
                      <strong>{row.count}</strong>
                      <small>{row.percent}% dos atendimentos</small>
                    </div>
                  ))}
                </div>
              </article>

              <article className="report-panel">
                <div className="panel-head compact">
                  <div>
                    <h2>Agenda e produtividade</h2>
                    <p>Controle de retornos, mensagens e bases prontas.</p>
                  </div>
                  <CalendarClock size={20} />
                </div>
                <div className="report-facts">
                  <div><span>Mensagens no historico</span><strong>{reportData.totalMessages}</strong></div>
                  <div><span>Retornos futuros</span><strong>{reportData.futureReturns}</strong></div>
                  <div><span>Modelos de resposta</span><strong>{templates.length}</strong></div>
                  <div><span>Ultimo atendimento</span><strong>{formatDate(reportData.latestConversation?.createdAt)}</strong></div>
                </div>
              </article>

              <article className="report-panel">
                <div className="panel-head compact">
                  <div>
                    <h2>Calculos judiciais e previdenciarios</h2>
                    <p>Volume financeiro estimado e distribuicao por area.</p>
                  </div>
                  <Calculator size={20} />
                </div>
                <div className="report-value">
                  <span>Total estimado</span>
                  <strong>{formatCurrency(reportData.totalCalculationValue)}</strong>
                  <small>Media por calculo: {formatCurrency(reportData.averageCalculationValue)}</small>
                </div>
                <div className="report-bars">
                  {reportData.calculationRows.map((row) => (
                    <div className="report-bar-row" key={row.label}>
                      <span>{row.label}</span>
                      <div className="report-bar-track"><div style={{ width: `${row.percent}%` }} /></div>
                      <strong>{row.count}</strong>
                    </div>
                  ))}
                </div>
              </article>

              <article className="report-panel">
                <div className="panel-head compact">
                  <div>
                    <h2>Disparos e seguranca</h2>
                    <p>Fila preparada e rastreabilidade do sistema.</p>
                  </div>
                  <ShieldCheck size={20} />
                </div>
                <div className="report-facts">
                  <div><span>Campanhas preparadas</span><strong>{broadcasts.length}</strong></div>
                  <div><span>Destinatarios na fila</span><strong>{reportData.totalRecipients}</strong></div>
                  <div><span>WhatsApp / E-mail</span><strong>{reportData.whatsappBroadcasts} / {reportData.emailBroadcasts}</strong></div>
                  <div><span>Banco de dados</span><strong>{systemStatus?.database.ok ? 'Online' : apiStatus === 'online' ? 'Online' : 'Local'}</strong></div>
                  <div><span>Usuarios cadastrados</span><strong>{users.length}</strong></div>
                  <div><span>Eventos auditados</span><strong>{auditLogs.length}</strong></div>
                </div>
                <p className="report-last-event">Ultimo evento: {reportData.latestAudit ? `${reportData.latestAudit.summary} em ${formatDateTime(reportData.latestAudit.createdAt)}` : 'Sem evento registrado'}</p>
              </article>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
