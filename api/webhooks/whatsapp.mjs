import { ensureDatabase, getPool, recordWhatsAppWebhookEvent } from '../_db.mjs'

export default async function handler(req, res) {

  // Verificação do webhook (GET)
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

  // Recebimento de mensagens (POST)
  if (req.method === 'POST') {
    res.status(200).end() // Responde imediatamente para a Meta

    try {
      const body = req.body
      if (body.object !== 'whatsapp_business_account') return

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value

          // Processa mensagens recebidas
          if (value?.messages) {
            for (const msg of value.messages) {
              await processIncomingMessage(msg, value)
            }
          }

          // Atualiza status de entregas (lido, entregue, etc.)
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
    } catch (err) {
      console.error('Erro webhook WhatsApp:', err.message)
    }

    return
  }

  res.status(405).end()
}

async function processIncomingMessage(msg, value) {
  const from = msg.from // número do cliente ex: 5571999999999
  const type = msg.type
  const contact = value.contacts?.[0]
  const contactName = contact?.profile?.name || from
  const now = new Date()
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const isoStr = now.toISOString()

  // Extrai o texto conforme o tipo da mensagem
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
    text = `Mensagem do