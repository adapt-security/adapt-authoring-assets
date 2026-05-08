import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import checkDuplicate from '../lib/utils/checkDuplicate.js'

const makeDeps = ({ findResults = [], hashValue = 'h1' } = {}) => {
  const calls = { find: [], generateHash: 0, makeDuplicateError: 0 }
  let i = 0
  return {
    calls,
    deps: {
      findFn: async q => {
        calls.find.push(q)
        return findResults[i++] ?? []
      },
      generateHash: async () => {
        calls.generateHash++
        return hashValue
      },
      makeDuplicateError: data => {
        calls.makeDuplicateError++
        const err = new Error('DUPLICATE_ASSET')
        err.code = 'DUPLICATE_ASSET'
        err.data = data
        return err
      }
    }
  }
}

describe('checkDuplicate', () => {
  it('returns null and skips hashing when no asset shares the file size', async () => {
    const { deps, calls } = makeDeps({ findResults: [[]] })
    const result = await checkDuplicate('/tmp/a', 100, undefined, deps)
    assert.equal(result, null)
    assert.equal(calls.generateHash, 0)
    assert.equal(calls.find.length, 1)
    assert.deepEqual(calls.find[0], { size: 100 })
  })

  it('returns hash when a size match exists but no hash match', async () => {
    const sizeMatch = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }
    const { deps, calls } = makeDeps({ findResults: [[sizeMatch], []], hashValue: 'h1' })
    const result = await checkDuplicate('/tmp/a', 100, undefined, deps)
    assert.equal(result, 'h1')
    assert.equal(calls.generateHash, 1)
    assert.equal(calls.find.length, 2)
    assert.deepEqual(calls.find[1], { hash: 'h1' })
  })

  it('throws DUPLICATE_ASSET when both size and hash match', async () => {
    const match = { _id: { toString: () => 'aaaaaaaaaaaaaaaaaaaaaaaa' } }
    const { deps } = makeDeps({ findResults: [[match], [match]], hashValue: 'h1' })
    await assert.rejects(
      () => checkDuplicate('/tmp/a', 100, undefined, deps),
      e => e.code === 'DUPLICATE_ASSET' && e.data.hash === 'h1' && e.data.assetId === 'aaaaaaaaaaaaaaaaaaaaaaaa'
    )
  })

  it('returns hash when multiple assets share a size but none share the hash (size-collision regression guard)', async () => {
    const a = { _id: 'a' }
    const b = { _id: 'b' }
    const { deps } = makeDeps({ findResults: [[a, b], []], hashValue: 'h1' })
    const result = await checkDuplicate('/tmp/a', 100, undefined, deps)
    assert.equal(result, 'h1')
  })

  it('throws DUPLICATE_ASSET when multiple share a size and one shares the hash', async () => {
    const a = { _id: 'a' }
    const b = { _id: { toString: () => 'b' } }
    const { deps } = makeDeps({ findResults: [[a, b], [b]], hashValue: 'h1' })
    await assert.rejects(
      () => checkDuplicate('/tmp/a', 100, undefined, deps),
      e => e.code === 'DUPLICATE_ASSET' && e.data.assetId === 'b'
    )
  })

  it('applies excludeQuery to both size and hash lookups', async () => {
    const { deps, calls } = makeDeps({ findResults: [[{ _id: 'x' }], []], hashValue: 'h1' })
    await checkDuplicate('/tmp/a', 100, { _id: { $ne: 'self' } }, deps)
    assert.deepEqual(calls.find[0], { size: 100, _id: { $ne: 'self' } })
    assert.deepEqual(calls.find[1], { hash: 'h1', _id: { $ne: 'self' } })
  })
})
