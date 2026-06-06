import { ensureDatabase, getPool, getUsers, handleApiError, hashPassword, logAudit, mapUser, requireAuth, requireSystemRegistered, sendJson } from './_db.mjs'

export default async function handler(request, response) {
  try {
    await ensureDatabase()
    const authUser = requireAuth(request, ['admin'])
    await requireSystemRegistered()

    if (request.method === 'GET') {
      sendJson(response, 200, await getUsers())
      return
    }

    if (request.method === 'POST') {
      const body = request.body
      const result = await getPool().query(
        `
          INSERT INTO users (name, email, password_hash, role, created_at)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, name, email, role, created_at
        `,
        [body.name, body.email, hashPassword(body.password), body.role || 'atendente', new Date().toISOString()],
      )
      const createdUser = mapUser(result.rows[0])

      await logAudit({
        request,
        user: authUser,
        action: 'user_created',
        entity: 'user',
        entityId: createdUser.id,
        summary: `Usuario ${createdUser.name} criado com perfil ${createdUser.role}.`,
        metadata: { email: createdUser.email, role: createdUser.role },
      })

      sendJson(response, 201, createdUser)
      return
    }

    if (request.method === 'PUT') {
      const body = request.body
      const fields = [body.name, body.email, body.role || 'atendente', new Date().toISOString(), authUser.id, body.id]
      const passwordSql = body.password ? ', password_hash = $7' : ''

      if (body.password) {
        fields.push(hashPassword(body.password))
      }

      const result = await getPool().query(
        `
          UPDATE users
          SET name = $1, email = $2, role = $3, updated_at = $4, updated_by = $5, version = version + 1${passwordSql}
          WHERE id = $6
          RETURNING id, name, email, role, created_at
        `,
        fields,
      )

      if (result.rowCount === 0) {
        sendJson(response, 404, { error: 'Usuario nao encontrado.' })
        return
      }

      const updatedUser = mapUser(result.rows[0])

      await logAudit({
        request,
        user: authUser,
        action: 'user_updated',
        entity: 'user',
        entityId: updatedUser.id,
        summary: `Usuario ${updatedUser.name} atualizado com perfil ${updatedUser.role}.`,
        metadata: { email: updatedUser.email, role: updatedUser.role, passwordChanged: Boolean(body.password) },
      })

      sendJson(response, 200, updatedUser)
      return
    }

    if (request.method === 'DELETE') {
      const id = Number(request.query?.id || request.body?.id)

      if (!id) {
        sendJson(response, 400, { error: 'Informe o usuario para excluir.' })
        return
      }

      if (Number(authUser.id) === id) {
        sendJson(response, 400, { error: 'Nao e permitido excluir o proprio usuario logado.' })
        return
      }

      const current = await getPool().query('SELECT id, name, email, role FROM users WHERE id = $1', [id])

      if (current.rowCount === 0) {
        sendJson(response, 404, { error: 'Usuario nao encontrado.' })
        return
      }

      await getPool().query('DELETE FROM users WHERE id = $1', [id])

      await logAudit({
        request,
        user: authUser,
        action: 'user_deleted',
        entity: 'user',
        entityId: id,
        summary: `Usuario ${current.rows[0].name} excluido.`,
        metadata: { email: current.rows[0].email, role: current.rows[0].role },
      })

      sendJson(response, 200, { ok: true })
      return
    }

    sendJson(response, 405, { error: 'Metodo nao permitido.' })
  } catch (error) {
    await handleApiError(response, error)
  }
}
