import nodemailer from 'nodemailer'
import {
  ensureDatabase,
  getBroadcasts,
  getEmailSettings,
  getPool,
  handleApiError,
  logAudit,
  mapBroadcast,
  recordBroadcastDelivery,
  recordWhatsAppWebhookEvent,
  requireAuth,
  requireSystemRegistered,
  sendJson,
  updateWhatsAppDeliveryStatus,
} from './_db.mjs'

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

async function getEmailAccounts() {
  const savedSettings = await getEmailSettings({ includeSecrets: true })
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

async function getPublicEmailAccounts() {
  return (await getEmailAccounts()).map(({ id, label, from }) => ({ id, label, from }))
}

async function getEmailAccount(accountId) {
  const accounts = await getEmailAccounts()
  return accounts.find((account) => account.id === accountId) || accounts[0] || null
}

async function getIntegrationStatus() {
  const emailAccounts = await getPublicEmailAccounts()

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

function sendText(response, status, text) {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Content-Type', 'text/plain; charset=utf-8')
  response.status(status).send(String(text || ''))
}

function parseWebhookBody(body) {
  if (!body) {
    return {}
  }

  if (typeof body === 'string') {
    return JSON.parse(body)
  }

  return body
}

function getWebhookChanges(payload) {
  return payload?.entry?.flatMap((entry) => entry.changes || []) || []
}

function getWebhookStatusError(statusPayload) {
  return (statusPayload?.errors || [])
    .map((error) => error.error_data?.details || error.message || error.title || error.code)
    .filter(Boolean)
    .join(' | ')
}

export async function handleWhatsAppWebhook(request, response) {
  if (request.method === 'GET') {
    const mode = request.query?.['hub.mode']
    const token = request.query?.['hub.verify_token']
    const challenge = request.query?.['hub.challenge']
    const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN

    if (!expectedToken) {
      sendJson(response, 503, { error: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN nao configurado na Vercel.' })
      return
    }

    if (mode === 'subscribe' && token === expectedToken) {
      sendText(response, 200, challenge)
      return
    }

    sendJson(response, 403, { error: 'Token de verificacao invalido.' })
    return
  }

  if (request.method === 'POST') {
    const payload = parseWebhookBody(request.body)

    for (const change of getWebhookChanges(payload)) {
      const value = change.value || {}

      for (const statusPayload of value.statuses || []) {
        const errorMessage = getWebhookStatusError(statusPayload)

        await recordWhatsAppWebhookEvent({
          eventType: 'status',
          providerMessageId: statusPayload.id,
          recipient: statusPayload.recipient_id,
          status: statusPayload.status || 'unknown',
          payload: statusPayload,
        })

        await updateWhatsAppDeliveryStatus({
          providerMessageId: statusPayload.id,
          recipient: statusPayload.recipient_id,
          status: statusPayload.status || 'unknown',
          payload: statusPayload,
          errorMessage,
        })
      }

      for (const messagePayload of value.messages || []) {
        await recordWhatsAppWebhookEvent({
          eventType: 'message',
          providerMessageId: messagePayload.id,
          recipient: messagePayload.from,
          status: messagePayload.type || 'received',
          payload: messagePayload,
        })
      }
    }

    sendJson(response, 200, { ok: true })
    return
  }

  sendJson(response, 405, { error: 'Metodo nao permitido.' })
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

  const response = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    let details = ''
    try {
      const rawBody = await response.text()
      const payload = rawBody ? JSON.parse(rawBody) : null
      const message = payload?.error?.message || payload?.error?.error_user_msg || rawBody
      const code = payload?.error?.code ? ` codigo ${payload.error.code}` : ''
      const type = payload?.error?.type ? ` ${payload.error.type}` : ''
      const hint = getWhatsAppErrorHint(payload?.error?.code)
      details = message ? `:${type}${code} - ${message}${hint ? ` | ${hint}` : ''}` : ''
    } catch {
      details = ''
    }
    throw new Error(`WhatsApp respondeu ${response.status}${details}`)
  }

  const payload = await response.json()
  return {
    providerMessageId: payload?.messages?.[0]?.id || null,
    payload,
    to: normalizedTo,
  }
}

async function sendEmailMessage(to, subject, message, accountId) {
  const account = await getEmailAccount(accountId)

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
  const integrationStatus = await status
  const configured = broadcast.channel === 'whatsapp' ? integrationStatus.whatsapp : integrationStatus.email

  if (!configured) {
    return { sent: 0, failed: broadcast.recipientCount, error: `Integracao de ${broadcast.channel === 'whatsapp' ? 'WhatsApp' : 'e-mail'} ainda nao configurada.` }
  }

  let sent = 0
  let failed = 0
  const errors = []

  for (const recipient of parseRecipients(broadcast.recipients)) {
    try {
      if (broadcast.channel === 'whatsapp') {
        const delivery = await sendWhatsAppMessage(recipient, broadcast.message, broadcast.whatsappTemplateName, broadcast.whatsappTemplateLanguage)
        await recordBroadcastDelivery({
          broadcastId: broadcast.id,
          recipient: delivery.to,
          providerMessageId: delivery.providerMessageId,
          status: 'api_sent',
          payload: delivery.payload,
        })
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
  const now = new Date().toISOString()
  const due = await getPool().query(
    `
      SELECT * FROM broadcasts
      WHERE scheduled_at IS NOT NULL
        AND scheduled_at <= $1
        AND status IN ('agendado', 'fila_preparada')
      ORDER BY scheduled_at ASC
      LIMIT 20
    `,
    [now],
  )

  const processed = []

  for (const row of due.rows) {
    const broadcast = mapBroadcast(row)
    const result = await sendBroadcast(broadcast)
    const nextStatus = result.error || result.failed > 0 ? 'aguardando_integracao' : 'enviado'
    const updated = await getPool().query('UPDATE broadcasts SET status = $1, sent_count = $2, failed_count = $3, updated_at = $4, version = version + 1 WHERE id = $5 RETURNING *', [
      nextStatus,
      result.sent,
      result.failed,
      new Date().toISOString(),
      broadcast.id,
    ])

    await logAudit({
      request,
      user: null,
      action: 'broadcast_cron_sent',
      entity: 'broadcast',
      entityId: broadcast.id,
      summary: `Disparo agendado ${broadcast.channel} processado: ${result.sent} enviado(s), ${result.failed} falha(s).`,
      metadata: { channel: broadcast.channel, ...result },
    })

    processed.push({ broadcast: mapBroadcast(updated.rows[0]), ...result })
  }

  return processed
}

export default async function handler(request, response) {
  try {
    await ensureDatabase()

    if (request.query?.webhook === 'whatsapp') {
      await handleWhatsAppWebhook(request, response)
      return
    }

    if (request.method === 'GET' && request.query?.cron === 'send-scheduled') {
      const expectedSecret = process.env.CRON_SECRET
      const authorization = request.headers.authorization || request.headers.Authorization || ''

      if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
        sendJson(response, 401, { error: 'Cron nao autorizado.' })
        return
      }

      await requireSystemRegistered()
      const processed = await processScheduledBroadcasts(request)
      sendJson(response, 200, { ok: true, processed: processed.length })
      return
    }

    const authUser = requireAuth(request, ['admin', 'atendente', 'sdr'])
    await requireSystemRegistered()

    if (request.method === 'GET') {
      if (request.query?.integrations) {
        sendJson(response, 200, await getIntegrationStatus())
        return
      }

      sendJson(response, 200, await getBroadcasts())
      return
    }

    if (request.method === 'POST') {
      const body = request.body
      const recipientCount = countRecipients(body.recipients)
      const result = await getPool().query(
        `
          INSERT INTO broadcasts (
            channel, name, subject, sender_account, whatsapp_template_name, whatsapp_template_language, message, recipients, recipient_count, status,
            scheduled_at, created_by, created_by_email, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING *
        `,
        [
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
        ],
      )
      const broadcast = mapBroadcast(result.rows[0])

      await logAudit({
        request,
        user: authUser,
        action: 'broadcast_created',
        entity: 'broadcast',
        entityId: broadcast.id,
        summary: `Disparo ${broadcast.channel} preparado com ${broadcast.recipientCount} destinatarios.`,
        metadata: { channel: broadcast.channel, scheduledAt: broadcast.scheduledAt },
      })

      sendJson(response, 201, broadcast)
      return
    }

    if (request.method === 'PATCH') {
      const body = request.body

      if (body.action !== 'send') {
        sendJson(response, 400, { error: 'Acao invalida.' })
        return
      }

      const current = await getPool().query('SELECT * FROM broadcasts WHERE id = $1', [body.id])

      if (current.rowCount === 0) {
        sendJson(response, 404, { error: 'Disparo nao encontrado.' })
        return
      }

      const broadcast = mapBroadcast(current.rows[0])
      const result = await sendBroadcast(broadcast)
      const nextStatus = result.error || result.failed > 0 ? 'aguardando_integracao' : 'enviado'
      const updated = await getPool().query('UPDATE broadcasts SET status = $1, sent_count = $2, failed_count = $3, updated_at = $4, updated_by = $5, version = version + 1 WHERE id = $6 RETURNING *', [
        nextStatus,
        result.sent,
        result.failed,
        new Date().toISOString(),
        authUser.id,
        broadcast.id,
      ])
      const updatedBroadcast = mapBroadcast(updated.rows[0])

      await logAudit({
        request,
        user: authUser,
        action: 'broadcast_sent',
        entity: 'broadcast',
        entityId: broadcast.id,
        summary: `Disparo ${broadcast.channel} processado: ${result.sent} enviado(s), ${result.failed} falha(s).`,
        metadata: { channel: broadcast.channel, ...result },
      })

      sendJson(response, 200, { broadcast: updatedBroadcast, ...result })
      return
    }

    if (request.method === 'DELETE') {
      const id = Number(request.query?.id || request.body?.id)

      if (!id) {
        sendJson(response, 400, { error: 'Informe o disparo para excluir.' })
        return
      }

      const current = await getPool().query('SELECT id, channel, name, recipient_count FROM broadcasts WHERE id = $1', [id])

      if (current.rowCount === 0) {
        sendJson(response, 404, { error: 'Disparo nao encontrado.' })
        return
      }

      await getPool().query('DELETE FROM broadcasts WHERE id = $1', [id])

      await logAudit({
        request,
        user: authUser,
        action: 'broadcast_deleted',
        entity: 'broadcast',
        entityId: id,
        summary: `Disparo ${current.rows[0].name} excluido.`,
        metadata: { channel: current.rows[0].channel, recipientCount: current.rows[0].recipient_count },
      })

      sendJson(response, 200, { ok: true })
      return
    }

    sendJson(response, 405, { error: 'Metodo nao permitido.' })
  } catch (error) {
    await handleApiError(response, error)
  }
}
