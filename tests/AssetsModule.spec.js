import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('AssetsModule', () => {
  describe('module exports', () => {
    it('should export AssetsModule class', async () => {
      const module = await import('../lib/AssetsModule.js')
      assert.ok(module.default)
      assert.equal(typeof module.default, 'function')
    })
  })
})
