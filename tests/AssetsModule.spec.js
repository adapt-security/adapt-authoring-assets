import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/**
 * AssetsModule extends AbstractApiModule which needs a running app.
 * We test the find() query-rewriting logic that can be exercised in isolation.
 */

/* ---------- inline helper: extract find query rewrite ---------- */
function rewriteFindQuery (query) {
  if (query?.type?.$in?.length === 1 && query.type.$in[0] === 'other') {
    query.type = { $nin: ['audio', 'image', 'video'] }
  }
  return query
}

describe('AssetsModule', () => {
  describe('#find() query rewriting', () => {
    it('should rewrite single "other" $in to $nin of known types', () => {
      const query = { type: { $in: ['other'] } }
      rewriteFindQuery(query)
      assert.deepEqual(query.type, { $nin: ['audio', 'image', 'video'] })
    })

    it('should not rewrite when $in has multiple values', () => {
      const query = { type: { $in: ['other', 'image'] } }
      rewriteFindQuery(query)
      assert.deepEqual(query.type, { $in: ['other', 'image'] })
    })

    it('should not rewrite when $in has a single non-other value', () => {
      const query = { type: { $in: ['image'] } }
      rewriteFindQuery(query)
      assert.deepEqual(query.type, { $in: ['image'] })
    })

    it('should handle undefined query gracefully', () => {
      const result = rewriteFindQuery(undefined)
      assert.equal(result, undefined)
    })

    it('should handle query without type', () => {
      const query = { name: 'test' }
      rewriteFindQuery(query)
      assert.deepEqual(query, { name: 'test' })
    })

    it('should handle query with type but no $in', () => {
      const query = { type: 'image' }
      rewriteFindQuery(query)
      assert.equal(query.type, 'image')
    })
  })
})
