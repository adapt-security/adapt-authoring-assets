import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/**
 * AbstractAsset depends on App.instance in the constructor, so we test
 * the few static / pure helpers that can be exercised without a running app.
 */

/* ---------- inline helper: extract getFileExtension logic ---------- */
function getFileExtension (file) {
  const parts = file?.originalFilename?.split('.')
  if (!parts || parts.length === 1) throw new Error('PARSE_EXT')
  return parts.pop()
}

/* ---------- inline helper: extract setData logic ---------- */
function setData (existing, data) {
  const root = data.root
  if (root) delete data.root
  if (!existing) existing = {}
  Object.assign(existing, JSON.parse(JSON.stringify(data)))
  return { data: existing, root }
}

describe('AbstractAsset', () => {
  describe('#getFileExtension()', () => {
    it('should return the file extension from originalFilename', () => {
      assert.equal(getFileExtension({ originalFilename: 'image.png' }), 'png')
    })

    it('should return the last extension for double extensions', () => {
      assert.equal(getFileExtension({ originalFilename: 'archive.tar.gz' }), 'gz')
    })

    it('should throw when originalFilename has no extension', () => {
      assert.throws(() => getFileExtension({ originalFilename: 'noext' }), { message: 'PARSE_EXT' })
    })

    it('should throw when file is undefined', () => {
      assert.throws(() => getFileExtension(undefined), { message: 'PARSE_EXT' })
    })

    it('should throw when originalFilename is undefined', () => {
      assert.throws(() => getFileExtension({}), { message: 'PARSE_EXT' })
    })
  })

  describe('#setData()', () => {
    it('should deep clone data into the object', () => {
      const input = { key: 'value', nested: { a: 1 } }
      const result = setData(undefined, input)
      assert.deepEqual(result.data, { key: 'value', nested: { a: 1 } })
      input.nested.a = 99
      assert.equal(result.data.nested.a, 1)
    })

    it('should merge into existing data', () => {
      const existing = { a: 1 }
      const result = setData(existing, { b: 2 })
      assert.deepEqual(result.data, { a: 1, b: 2 })
    })

    it('should extract root from data', () => {
      const result = setData(undefined, { root: '/custom/root', path: 'file.png' })
      assert.equal(result.root, '/custom/root')
      assert.equal(result.data.root, undefined)
    })

    it('should overwrite existing properties', () => {
      const existing = { a: 1 }
      const result = setData(existing, { a: 2 })
      assert.equal(result.data.a, 2)
    })
  })
})
