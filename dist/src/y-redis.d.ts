/**
 * Handles persistence of a sinle doc.
 */
export class PersistenceDoc {
    /**
     * @param {RedisPersistence} rp
     * @param {string} name
     * @param {Y.Doc} doc
     */
    constructor(rp: RedisPersistence, name: string, doc: Y.Doc);
    rp: RedisPersistence;
    name: string;
    doc: Y.Doc;
    mux: mutex.mutex;
    /**
     * Next expected index / len of the list of updates
     * @type {number}
     */
    _clock: number;
    _fetchingClock: number;
    /**
     * @param {Uint8Array} update
     */
    updateHandler: (update: Uint8Array) => void;
    synced: Promise<PersistenceDoc>;
    /**
     * @return {Promise<any>}
     */
    destroy(): Promise<any>;
    /**
     * Get all new updates from redis and increase clock if necessary.
     *
     * @return {Promise<PersistenceDoc>}
     */
    getUpdates(): Promise<PersistenceDoc>;
}
/**
 * @extends Observable<string>
 */
export class RedisPersistence extends Observable<string> {
    /**
     * @param {Object} [opts]
     * @param {Object|null} [opts.redisOpts]
     * @param {Array<Object>|null} [opts.redisClusterOpts]
     */
    constructor({ redisOpts, redisClusterOpts }?: {
        redisOpts?: Object | null;
        redisClusterOpts?: Object[] | null;
    } | undefined);
    redis: Redis.Redis | Redis.Cluster;
    sub: Redis.Redis;
    /**
     * @type {Map<string,PersistenceDoc>}
     */
    docs: Map<string, PersistenceDoc>;
    /**
     * @param {string} name
     * @param {Y.Doc} ydoc
     * @return {PersistenceDoc}
     */
    bindState(name: string, ydoc: Y.Doc): PersistenceDoc;
    destroy(): Promise<void>;
    /**
     * @param {string} name
     */
    closeDoc(name: string): Promise<any> | undefined;
    /**
     * @param {string} name
     * @return {Promise<any>}
     */
    clearDocument(name: string): Promise<any>;
    /**
     * Destroys this instance and removes all known documents from the database.
     * After that this Persistence instance is destroyed.
     *
     * @return {Promise<any>}
     */
    clearAllDocuments(): Promise<any>;
}
import * as Y from "yjs";
import * as mutex from "lib0/mutex";
import { Observable } from "lib0/observable";
import Redis from "ioredis";
