# Y-Hub API Documentation

Y-Hub is a collaborative document backend built on Yjs. It implements the standard y-websocket protocol and extends it with attribution, history management, and selective undo/redo capabilities.

All endpoints require an `auth-cookie` which will be check via the PERM
CALLBACK.

It is assumed that all documents can be identified by a unique `{guid}`.

## WebSocket

The standard WebSocket backend that is compatible with y-websocket, and TipTapProvider.

For each Yjs document, there is always a gc'd version, and a non-gc'd version.
Optionally, you may fork the document to a branch, which users can use for
implementing suggestions. Branched documents have a gc'd version and a non-gc'd
version as well.

* `ws://{host}/ws/{guid}` parameters: `{ gc?: boolean, branch?: string }`
  * `gc=true` (default): standard garbage-collected document
  * `gc=false`: full document history which can be used to reconstruct editing history.
  * `branch="main"`: (default) The default branch-name if not specified otherwise.
  * `branch=string`: Optionally, define a custom branch. Changes won't be automatically synced with other branches.

## Rollback

Rollback all changes that match the pattern. The changes will be distributed via
websockets.

* `POST /rollback/{guid}` parameters: `{ from?: number, to?: number, by?: string }`
  * `from`/`to`: unix timestamp range filter
  * `by=string`: comma-separated list of user-ids that matches the attributions

### Example

* Rollback all changes that happened after timestamp `X`: `POST /rollback/{doc-guid}?from=X`
  * If your "versions" have timestamps, this call enables you to revert to a specific
    version of the document.
* Rollback all changes from user-id `U` that happened between timestamp `X` and `Y`: `POST /rollback/{doc-guid}?by=U&from=X&to=Y`
  * This call enables you to undo all changes within a certain editing-interval.

## History

Visualize attributed changes using either pure deltas or by retrieving the
before and after state of a Yjs doc. Optionally, include relevant attributions.

* `GET /history/{guid}` parameters: `{ from?: number, to?: number, doc?: boolean, diff?: boolean, attributions?: boolean }`
  * `from`/`to`: unix timestamp range filter
  * `doc=true`: include encoded Yjs docs
  * `diff=true`: include delta diff
  * `attributions=true`: include attributions
  * Returns `{ prevDoc?: Y.Doc, nextDoc?: Y.Doc, attributions: Y.IdMap, state?: Delta, diff?: Delta }`

## Timestamps

Retrieve all editing-timestamps for a certain document. Use
the timestamps API and the history API to reconstruct an editing trail.

* `GET /timestamps/{guid}` parameters: `{ from?: number, to?: number }`
  * `from`/`to`: unix timestamp range filter
  * Returns `Array<number>`

## Webhooks

Webhooks are configured using environment variables.

* `YDOC_UPDATE_CALLBACK=http://localhost:5173/ydoc` body: `encoded ydoc` - Called whenever the Yjs document was updated (after a debounce)
* `YDOC_CHANGE_CALLBACK=http://localhost:5173/ydoc` body: `{ ydoc: v2 encoded ydoc, delta: delta describing all changes }` - Called whenever the Yjs document was updated (after a debounce). 
* `AUTH_PERM_CALLBACK=http://localhost:5173/auth/perm` - Called to check Authentication of a client.

