import { ensureDatabase, getPool, handleApiError, hashPassword, logAudit, requireAuth, sendJson, verifyPassword } from '../_db.mjs'

export default async function handler(request, response) {
  try {
    await ensureDatabase()

    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Metodo nao permitido.' })
      return
    }

    const authUser = requireAuth(request)
    const { userId, currentPassword, newPassword } = request.body

    if (Number(authUser.id) !== Number(userId) && authUser.role !== 'admin') {
      sendJson(response, 403, { error: 'Permissao insuficiente.' })
      return
    }

    const result = await getPool().query('SELECT * FROM users WHERE id = $1', [userId])
    const user = result.rows[0]

    if (!user || !verifyPassword(currentPassword, user.password_hash)) {
      sendJson(response, 401, { error: 'Senha atual invalida.' })
      return
    }

    if (!newPassword || newPassword.length < 6) {
      sendJson(response, 400, { error: 'A nova senha deve ter pelo menos 6 caracteres.' })
      return
    }

    await getPool().query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(newPassword), userId])
    await logAudit({
      request,
      user: authUser,
      action: 'password_changed',
      entity: 'user',
      entityId: userId,
      summary: `Senha alterada para ${user.name}.`,
      metadata: { targetEmail: user.email },
    })
    sendJson(response, 200, { ok: true })
  } catch (error) {
    await handleApiError(response, error)
  }
}
