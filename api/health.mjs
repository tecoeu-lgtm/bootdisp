import { ensureDatabase, handleApiError, sendJson } from './_db.mjs'

export default async function handler(_request, response) {
  try {
    await ensureDatabase()
    sendJson(response, 200, { ok: true })
  } catch (error) {
    await handleApiError(response, error)
  }
}
