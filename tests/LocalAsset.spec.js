import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('LocalAsset', () => {
  describe('module exports', () => {
    it('should export LocalAsset class', async () => {
      const module = await import('../lib/LocalAsset.js')
      assert.ok(module.default)
      assert.equal(typeof module.default, 'function')
    })
  })

  describe('static name', () => {
    it('should return "local" as the name', async () => {
      const { default: LocalAsset } = await import('../lib/LocalAsset.js')
      assert.equal(LocalAsset.name, 'local')
    })
  })
})
