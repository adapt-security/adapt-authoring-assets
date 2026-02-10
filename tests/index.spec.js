import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('index', () => {
  describe('module exports', () => {
    it('should export AssetsModule as default', async () => {
      const module = await import('../index.js')
      assert.ok(module.default)
      assert.equal(typeof module.default, 'function')
    })
  })
})
