import { ensureDatabase, getAuditLogs, handleApiError, requireAuth, requireSystemRegistered, sendJson } from './_db.mjs'

export default async function handler(request, response) {
  const path = request.url?.split('?')[0]

  // GET /api/monitoring/health
  if (path?.endsWith('/health')) {
    try {
      await ensureDatabase()
      sendJson(response, 200, { ok: true })
    } catch (error) {
      await handleApiError(response, error)
    }
    return
  }

  // GET /api/monitoring/audit-logs
  if (path?.endsWith('/audit-logs')) {
    try {
      await ensureDatabase()
      requireAuth(request, ['admin'])
      await requireSystemRegistered()
      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'Metodo nao permitido.' })
        return
      }
      sendJson(
        response,
        200,
        await getAuditLogs({
          limit: 150,
          action: request.query?.action || '',
          userEmail: request.query?.userEmail || '',
          dateFrom: request.query?.dateFrom || '',
          dateTo: request.query?.dateTo || '',
        }),
      )
    } catch (error) {
      await handleApiError(response, error)
    }
    return
  }

  sendJson(response, 404, { error: 'Rota nao encontrada.' })
}