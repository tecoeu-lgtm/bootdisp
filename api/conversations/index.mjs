import { getConversation, getConversations, getPool, handleApiError, logAudit, requireAuth, requireSystemRegistered, sendJson } from '../_db.mjs'

export default async function handler(request, response) {
  try {
    const authUser = requireAuth(request)
    await requireSystemRegistered()
    if (request.method === 'GET') {
      sendJson(response, 200, await getConversations())
      return
    }

    if (request.method === 'POST') {
      const body = request.body
      const result = await getPool().query(
        `
          INSERT INTO conversations (
            contact, company, phone, email, channel, subject, status, priority,
            responsible, last_update, created_at, scheduled_at, next_action
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING id
        `,
        [
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
        ],
      )

      await getPool().query('INSERT INTO messages (conversation_id, author, text, time) VALUES ($1, $2, $3, $4)', [
        result.rows[0].id,
        'client',
        'Contato cadastrado manualmente.',
        body.lastUpdate || body.createdAt,
      ])

      const conversation = await getConversation(result.rows[0].id)

      await logAudit({
        request,
        user: authUser,
        action: 'conversation_created',
        entity: 'conversation',
        entityId: conversation.id,
        summary: `Contato ${conversation.contact} cadastrado pelo canal ${conversation.channel}.`,
        metadata: { email: conversation.email, phone: conversation.phone, scheduledAt: conversation.scheduledAt },
      })

      sendJson(response, 201, conversation)
      return
    }

    sendJson(response, 405, { error: 'Metodo nao permitido.' })
  } catch (error) {
    await handleApiError(response, error)
  }
}
