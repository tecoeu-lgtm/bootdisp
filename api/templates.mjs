import { ensureDatabase, getPool, handleApiError, logAudit, requireAuth, requireSystemRegistered, sendJson } from './_db.mjs'

export default async function handler(request, response) {
  try {
    await ensureDatabase()
    const authUser = requireAuth(request)
    await requireSystemRegistered()

    if (request.method === 'GET') {
      const result = await getPool().query('SELECT id, title, body FROM templates ORDER BY id DESC')
      sendJson(
        response,
        200,
        result.rows.map((row) => ({ ...row, id: Number(row.id) })),
      )
      return
    }

    if (request.method === 'POST') {
      const body = request.body
      const result = await getPool().query('INSERT INTO templates (title, body) VALUES ($1, $2) RETURNING id, title, body', [
        body.title,
        body.body,
      ])
      const template = { ...result.rows[0], id: Number(result.rows[0].id) }

      await logAudit({
        request,
        user: authUser,
        action: 'template_created',
        entity: 'template',
        entityId: template.id,
        summary: `Modelo de resposta "${template.title}" criado.`,
      })

      sendJson(response, 201, template)
      return
    }

    if (request.method === 'DELETE') {
      const id = Number(request.query?.id || request.body?.id)

      if (!id) {
        sendJson(response, 400, { error: 'Informe o modelo para excluir.' })
        return
      }

      const current = await getPool().query('SELECT id, title FROM templates WHERE id = $1', [id])

      if (current.rowCount === 0) {
        sendJson(response, 404, { error: 'Modelo nao encontrado.' })
        return
      }

      await getPool().query('DELETE FROM templates WHERE id = $1', [id])

      await logAudit({
        request,
        user: authUser,
        action: 'template_deleted',
        entity: 'template',
        entityId: id,
        summary: `Modelo de resposta "${current.rows[0].title}" excluido.`,
      })

      sendJson(response, 200, { ok: true })
      return
    }

    sendJson(response, 405, { error: 'Metodo nao permitido.' })
  } catch (error) {
    await handleApiError(response, error)
  }
}
