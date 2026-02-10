import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('AbstractAsset', () => {
  describe('module exports', () => {
    it('should export AbstractAsset class', async () => {
      const module = await import('../lib/AbstractAsset.js')
      assert.ok(module.default)
      assert.equal(typeof module.default, 'function')
    })
  })

  describe('static name', () => {
    it('should return "local" as the default name', async () => {
      // AbstractAsset provides a default implementation that returns 'local'
      // Subclasses can override this static getter
      const { default: AbstractAsset } = await import('../lib/AbstractAsset.js')
      assert.equal(AbstractAsset.name, 'local')
    })
  })
})
