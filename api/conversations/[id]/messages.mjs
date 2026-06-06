import { getConversation, getPool, handleApiError, logAudit, requireAuth, requireSystemRegistered, sendJson } from '../../_db.mjs'

export default async function handler(request, response) {
  try {
    const authUser = requireAuth(request)
    await requireSystemRegistered()
    const id = Number(request.query.id)

    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Metodo nao permitido.' })
      return
    }

    const body = request.body

    await getPool().query('INSERT INTO messages (conversation_id, author, text, time) VALUES ($1, $2, $3, $4)', [
      id,
      body.author || 'agent',
      body.text,
      body.time,
    ])
    await getPool().query('UPDATE conversations SET status = $1, last_update = $2, updated_at = $3, updated_by = $4, version = version + 1 WHERE id = $5', [
      'em_atendimento',
      body.time,
      new Date().toISOString(),
      authUser.id,
      id,
    ])

    const conversation = await getConversation(id)

    await logAudit({
      request,
      user: authUser,
      action: 'message_sent',
      entity: 'conversation',
      entityId: id,
      summary: `Mensagem registrada no atendimento de ${conversation.contact}.`,
      metadata: { author: body.author || 'agent' },
    })

    sendJson(response, 201, conversation)
  } catch (error) {
    await handleApiError(response, error)
  }
}
