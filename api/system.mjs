import { getCompanySettings, getEmailSettings, getSystemStatus, handleApiError, registerSystem, requireAuth, saveCompanySettings, saveEmailSettings, sendJson } from './_db.mjs'

function getAction(request) {
  if (typeof request.query?.action === 'string') {
    return request.query.action
  }

  return new URL(request.url, 'http://localhost').searchParams.get('action') || ''
}

export default async function handler(request, response) {
  try {
    const action = getAction(request)

    if (action === 'status') {
      requireAuth(request, ['admin'])

      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'Metodo nao permitido.' })
        return
      }

      sendJson(response, 200, await getSystemStatus())
      return
    }

    if (action === 'register') {
      const authUser = requireAuth(request, ['admin'])

      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Metodo nao permitido.' })
        return
      }

      sendJson(response, 200, await registerSystem(request.body?.registrationKey, authUser, request))
      return
    }

    if (action === 'email-settings') {
      const authUser = requireAuth(request, ['admin'])

      if (request.method === 'GET') {
        sendJson(response, 200, await getEmailSettings())
        return
      }

      if (request.method === 'PUT') {
        const currentSettings = await getEmailSettings({ includeSecrets: true })
        const currentById = new Map(currentSettings.accounts.map((account) => [account.id, account.pass]))
        const accounts = Array.isArray(request.body?.accounts) ? request.body.accounts : []
        const mergedAccounts = accounts.map((account) => ({
          ...account,
          existingPass: account.pass ? '' : currentById.get(account.id) || '',
        }))

        sendJson(response, 200, await saveEmailSettings(mergedAccounts, authUser, request))
        return
      }

      sendJson(response, 405, { error: 'Metodo nao permitido.' })
      return
    }

    if (action === 'company-settings') {
      const authUser = requireAuth(request, ['admin'])

      if (request.method === 'GET') {
        sendJson(response, 200, await getCompanySettings())
        return
      }

      if (request.method === 'PUT') {
        sendJson(response, 200, await saveCompanySettings(request.body || {}, authUser, request))
        return
      }

      sendJson(response, 405, { error: 'Metodo nao permitido.' })
      return
    }

    sendJson(response, 404, { error: 'Rota nao encontrada.' })
  } catch (error) {
    await handleApiError(response, error)
  }
}
