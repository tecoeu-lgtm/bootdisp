export type OfflineSyncRecord = {
  id: string
  userKey: string
  path: string
  method: string
  body?: string
  createdAt: string
  attempts: number
  lastError?: string
}

const databaseName = 'jusprevconecta-offline'
const databaseVersion = 1
const syncStore = 'syncQueue'

function openOfflineDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)

    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(syncStore)) {
        const store = database.createObjectStore(syncStore, { keyPath: 'id' })
        store.createIndex('userKey', 'userKey', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function listOfflineSyncRecords(userKey: string) {
  const database = await openOfflineDatabase()

  return new Promise<OfflineSyncRecord[]>((resolve, reject) => {
    const transaction = database.transaction(syncStore, 'readonly')
    const store = transaction.objectStore(syncStore).index('userKey')
    const request = store.getAll(userKey)

    request.onsuccess = () => {
      resolve((request.result as OfflineSyncRecord[]).sort((first, second) => first.createdAt.localeCompare(second.createdAt)))
      database.close()
    }
    request.onerror = () => {
      reject(request.error)
      database.close()
    }
  })
}

export async function putOfflineSyncRecord(record: OfflineSyncRecord) {
  const database = await openOfflineDatabase()

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(syncStore, 'readwrite')
    transaction.objectStore(syncStore).put(record)
    transaction.oncomplete = () => {
      resolve()
      database.close()
    }
    transaction.onerror = () => {
      reject(transaction.error)
      database.close()
    }
  })
}

export async function deleteOfflineSyncRecord(id: string) {
  const database = await openOfflineDatabase()

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(syncStore, 'readwrite')
    transaction.objectStore(syncStore).delete(id)
    transaction.oncomplete = () => {
      resolve()
      database.close()
    }
    transaction.onerror = () => {
      reject(transaction.error)
      database.close()
    }
  })
}

export async function clearOfflineSyncRecords(userKey: string) {
  const records = await listOfflineSyncRecords(userKey)
  await Promise.all(records.map((record) => deleteOfflineSyncRecord(record.id)))
}
