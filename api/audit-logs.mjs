import { ensureDatabase, getAuditLogs, handleApiError, requireAuth, requireSystemRegistered, sendJson } from './_db.mjs'

export default async function handler(request, response) {
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
}
