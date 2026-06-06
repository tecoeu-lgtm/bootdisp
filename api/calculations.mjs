import { ensureDatabase, getCalculations, getPool, handleApiError, logAudit, mapCalculation, requireAuth, requireSystemRegistered, sendJson } from './_db.mjs'

export default async function handler(request, response) {
  try {
    await ensureDatabase()
    const authUser = requireAuth(request)
    await requireSystemRegistered()

    if (request.method === 'GET') {
      sendJson(response, 200, await getCalculations())
      return
    }

    if (request.method === 'POST') {
      const body = request.body
      const result = await getPool().query(
        `
          INSERT INTO calculations (
            kind, formula, client_name, reference, description, principal, correction,
            interest, fees, estimated_total, status, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING *
        `,
        [
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
        ],
      )
      const calculation = mapCalculation(result.rows[0])

      await logAudit({
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

      sendJson(response, 201, calculation)
      return
    }

    if (request.method === 'DELETE') {
      const id = Number(request.query?.id || request.body?.id)

      if (!id) {
        sendJson(response, 400, { error: 'Informe o calculo para excluir.' })
        return
      }

      const current = await getPool().query('SELECT id, kind, client_name, reference FROM calculations WHERE id = $1', [id])

      if (current.rowCount === 0) {
        sendJson(response, 404, { error: 'Calculo nao encontrado.' })
        return
      }

      await getPool().query('DELETE FROM calculations WHERE id = $1', [id])

      await logAudit({
        request,
        user: authUser,
        action: 'calculation_deleted',
        entity: 'calculation',
        entityId: id,
        summary: `Calculo ${current.rows[0].kind} de ${current.rows[0].client_name} excluido.`,
        metadata: { reference: current.rows[0].reference },
      })

      sendJson(response, 200, { ok: true })
      return
    }

    sendJson(response, 405, { error: 'Metodo nao permitido.' })
  } catch (error) {
    await handleApiError(response, error)
  }
}
