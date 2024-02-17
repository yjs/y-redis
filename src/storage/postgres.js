import * as Y from 'yjs'
import postgres from 'postgres'
import * as error from 'lib0/error'
import * as env from 'lib0/environment'

/**
 * @typedef {import('../storage.js').AbstractStorage} AbstractStorage
 */

/**
 * @param {Object} [conf]
 * @param {string} [conf.database]
 */
export const createPostgresStorage = async ({ database } = {}) => {
  // postgres://username:password@host:port/database
  const postgresUrl = env.ensureConf('postgres')
  const postgresConf = {}
  if (database) {
    postgresConf.database = database
  }
  const sql = postgres(postgresUrl, { database })
  const docsTableExists = await sql`
    SELECT EXISTS (
      SELECT FROM 
          pg_tables
      WHERE 
          tablename  = 'yredis_docs_v1'
    );
  `
  // we perform a check beforehand to avoid a pesky log message if the table already exists
  if (!docsTableExists || docsTableExists.length === 0 || !docsTableExists[0].exists) {
    await sql`
      CREATE TABLE IF NOT EXISTS yredis_docs_v1 (
          room        text,
          doc         text,
          r           SERIAL,
          update      bytea,
          sv          bytea,
          PRIMARY KEY (room,doc,r)
      );
    `
  }
  return new PostgresStorage(sql)
}

/**
 * A Storage implementation that persists documents in PostgreSQL.
 *
 * You probably want to adapt this to your own needs.
 *
 * @implements AbstractStorage
 */
class PostgresStorage {
  /**
   * @param {postgres.Sql} sql
   */
  constructor (sql) {
    this.sql = sql
  }

  /**
   * @param {string} room
   * @param {string} docname
   * @param {Y.Doc} ydoc
   * @returns {Promise<void>}
   */
  async persistDoc (room, docname, ydoc) {
    await this.sql`
      INSERT INTO yredis_docs_v1 (room,doc,r,update, sv)
      VALUES (${room},${docname},DEFAULT,${Y.encodeStateAsUpdateV2(ydoc)},${Y.encodeStateVector(ydoc)})
    `
  }

  /**
   * @param {string} room
   * @param {string} docname
   * @return {Promise<{ doc: Uint8Array, references: Array<number> } | null>}
   */
  async retrieveDoc (room, docname) {
    /**
     * @type {Array<{ room: string, doc: string, r: number, update: Buffer }>}
     */
    const rows = await this.sql`SELECT update,r from yredis_docs_v1 WHERE room = ${room} AND doc = ${docname}`
    if (rows.length === 0) {
      return null
    }
    const doc = Y.mergeUpdatesV2(rows.map(row => row.update))
    const references = rows.map(row => row.r)
    return { doc, references }
  }

  /**
   * @param {string} room
   * @param {string} docname
   * @return {Promise<Uint8Array|null>}
   */
  async retrieveStateVector (room, docname) {
    const rows = await this.sql`SELECT sv from yredis_docs_v1 WHERE room = ${room} AND doc = ${docname} LIMIT 1`
    if (rows.length > 1) {
      // expect that result is limited
      error.unexpectedCase()
    }
    return rows.length === 0 ? null : rows[0].sv
  }

  /**
   * @param {string} room
   * @param {string} docname
   * @param {Array<any>} storeReferences
   * @return {Promise<void>}
   */
  async deleteReferences (room, docname, storeReferences) {
    await this.sql`DELETE FROM yredis_docs_v1 WHERE room = ${room} AND doc = ${docname} AND r in (${storeReferences})`
  }

  async destroy () {
    await this.sql.end({ timeout: 5 }) // existing queries have five seconds to finish
  }
}

export const Storage = PostgresStorage
