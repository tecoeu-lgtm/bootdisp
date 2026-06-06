import { getConversation, getPool, handleApiError, logAudit, requireAuth, requireSystemRegistered, sendJson } from '../_db.mjs'

export default async function handler(request, response) {
  try {
    const authUser = requireAuth(request)
    await requireSystemRegistered()
    const id = Number(request.query.id)

    const current = await getConversation(id)

    if (!current) {
      sendJson(response, 404, { error: 'Atendimento nao encontrado.' })
      return
    }

    if (request.method === 'DELETE') {
      await getPool().query('DELETE FROM conversations WHERE id = $1', [id])

      await logAudit({
        request,
        user: authUser,
        action: 'conversation_deleted',
        entity: 'conversation',
        entityId: id,
        summary: `Atendimento de ${current.contact} excluido.`,
        metadata: { email: current.email, phone: current.phone, channel: current.channel },
      })

      sendJson(response, 200, { ok: true })
      return
    }

    if (request.method !== 'PATCH') {
      sendJson(response, 405, { error: 'Metodo nao permitido.' })
      return
    }

    const body = request.body

    await getPool().query(
      `
        UPDATE conversations
        SET status = $1, last_update = $2, scheduled_at = $3, next_action = $4,
            updated_at = $5, updated_by = $6, version = version + 1
        WHERE id = $7
      `,
      [
        body.status ?? current.status,
        body.lastUpdate ?? current.lastUpdate,
        body.scheduledAt ?? current.scheduledAt ?? null,
        body.nextAction ?? current.nextAction,
        new Date().toISOString(),
        authUser.id,
        id,
      ],
    )

    const updated = await getConversation(id)

    await logAudit({
      request,
      user: authUser,
      action: 'conversation_updated',
      entity: 'conversation',
      entityId: id,
      summary: `Atendimento de ${updated.contact} atualizado para ${updated.status}.`,
      metadata: { status: updated.status, scheduledAt: updated.scheduledAt, nextAction: updated.nextAction },
    })

    sendJson(response, 200, updated)
  } catch (error) {
    await handleApiError(response, error)
  }
}
