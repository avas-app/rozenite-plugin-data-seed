/**
 * Minimal IndexedDB access, used only to remember the fixtures directory.
 *
 * A `FileSystemDirectoryHandle` is a structured-cloneable object, so IndexedDB
 * can persist it across reloads — `localStorage` cannot, since it only holds
 * strings. That single constraint is the entire reason this file exists, which
 * is why it is a hand-rolled 40 lines rather than a dependency.
 */

const DB_NAME = 'rozenite-query-seed'
const STORE_NAME = 'handles'
const DB_VERSION = 1

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode)
        const request = run(tx.objectStore(STORE_NAME))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
        tx.oncomplete = () => db.close()
      }),
  )
}

export function idbGet<T>(key: string): Promise<T | undefined> {
  return transact<T | undefined>('readonly', (store) =>
    store.get(key) as IDBRequest<T | undefined>,
  )
}

export function idbSet(key: string, value: unknown): Promise<unknown> {
  return transact('readwrite', (store) => store.put(value, key))
}

export function idbDelete(key: string): Promise<unknown> {
  return transact('readwrite', (store) => store.delete(key))
}
