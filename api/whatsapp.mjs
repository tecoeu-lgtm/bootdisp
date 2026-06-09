import { ensureDatabase, getPool, recordWhatsAppWebhookEvent } from './_db.mjs'

export default async function handler(req, res) {

  if (req.method === 'GET') {
    const mode = req.query['hub.mode']
    const token = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']

    if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
      console.log('✅ Webhook verificado')
      return res.status(200).send(challenge)
    }
    return res.status(403).json({ error: 'Token de verificacao invalido.' })
  }

  if (req.method === 'POST') {
    try {
      const body = req.body
      if (body.object !== 'whatsapp_business_account') {
        return res.status(200).end()
      }

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value

          if (value?.messages) {
            for (const msg of value.messages) {
              await processIncomingMessage(msg, value)
            }
          }

          if (value?.statuses) {
            for (const status of value.statuses) {
              await recordWhatsAppWebhookEvent({
                eventType: 'status_update',
                providerMessageId: status.id,
                recipient: status.recipient_id,
                status: status.status,
                payload: status,
              })
            }
          }
        }
      }

      return res.status(200).end()
    } catch (err) {
      console.error('Erro webhook WhatsApp:', err.message)
      return res.status(200).end()
    }
  }

  res.status(405).end()
}

async function processIncomingMessage(msg, value) {
  const from = msg.from
  const type = msg.type
  const contact = value.contacts?.[0]
  const contactName = contact?.profile?.name || from

  const nowUtc = new Date()
  const nowBrasilia = new Date(nowUtc.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))

  const pad = (n) => String(n).padStart(2, '0')
  const timeStr = `${pad(nowBrasilia.getHours())}:${pad(nowBrasilia.getMinutes())}`
  const dateStr = `${nowBrasilia.getFullYear()}-${pad(nowBrasilia.getMonth() + 1)}-${pad(nowBrasilia.getDate())}`
  const createdAtStr = `${dateStr}T${timeStr}:00`
  const isoStr = nowUtc.toISOString()

  let text = ''
  if (type === 'text') {
    text = msg.text?.body || ''
  } else if (type === 'document') {
    text = `📄 Documento recebido: ${msg.document?.filename || 'arquivo'}`
  } else if (type === 'image') {
    text = '🖼️ Imagem recebida'
  } else if (type === 'audio') {
    text = '🎵 Áudio recebido'
  } else if (type === 'video') {
    text = '🎥 Vídeo recebido'
  } else {
    text = `Mensagem do tipo: ${type}`
  }

  console.log(`📨 Mensagem de ${contactName} (${from}): ${text}`)

  await recordWhatsAppWebhookEvent({
    eventType: 'message_received',
    providerMessageId: msg.id,
    recipient: from,
    status: 'received',
    payload: msg,
  })

  await ensureDatabase()
  const pool = getPool()

  const existing = await pool.query(
    `SELECT id FROM conversations WHERE phone = $1 AND channel = 'whatsapp' ORDER BY id DESC LIMIT 1`,
    [`+${from}`]
  )

  let conversationId

  if (existing.rows.length > 0) {
    conversationId = existing.rows[0].id
    await pool.query(
      `UPDATE conversations SET last_update = $1, updated_at = $2, version = version + 1 WHERE id = $3`,
      [timeStr, isoStr, conversationId]
    )
  } else {
    const inserted = await pool.query(
      `INSERT INTO conversations
        (contact, company, phone, email, channel, subject, status, priority, responsible, last_update, created_at, scheduled_at, next_action)
       VALUES ($1, $2, $3, $4, 'whatsapp', $5, 'em_atendimento', 'normal', 'Bot', $6, $7, NULL, '')
       RETURNING id`,
      [contactName, '', `+${from}`, '', `WhatsApp: ${text.substring(0, 50)}`, timeStr, createdAtStr]
    )
    conversationId = inserted.rows[0].id
  }

  await pool.query(
    `INSERT INTO messages (conversation_id, author, text, time) VALUES ($1, 'client', $2, $3)`,
    [conversationId, text, timeStr]
  )
}