import { createSessionToken, ensureDatabase, getPool, handleApiError, logAudit, sendJson, verifyPassword } from '../_db.mjs'

export default async function handler(request, response) {
  try {
    await ensureDatabase()

    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Metodo nao permitido.' })
      return
    }

    const { email, password } = request.body
    const result = await getPool().query('SELECT * FROM users WHERE lower(email) = lower($1)', [email])
    const user = result.rows[0]

    if (!user || !verifyPassword(password, user.password_hash)) {
      await logAudit({
        request,
        user: null,
        action: 'login_failed',
        entity: 'auth',
        summary: `Tentativa de login recusada para ${email || 'email vazio'}.`,
        metadata: { email },
      })
      sendJson(response, 401, { error: 'Email ou senha invalidos.' })
      return
    }

    await logAudit({
      request,
      user,
      action: 'login_success',
      entity: 'auth',
      entityId: user.id,
      summary: `${user.name} entrou no sistema.`,
    })

    sendJson(response, 200, {
      id: Number(user.id),
      name: user.name,
      email: user.email,
      role: user.role,
      token: createSessionToken(user),
    })
  } catch (error) {
    await handleApiError(response, error)
  }
}
