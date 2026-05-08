import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import generateHash from '../lib/utils/generateHash.js'

function createTempFile (content) {
  const filepath = path.join(os.tmpdir(), `test-hash-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.writeFileSync(filepath, content)
  return filepath
}

function expectedHash (content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

describe('generateHash', () => {
  it('should return a SHA-256 hex digest', async () => {
    const filepath = createTempFile('hello world')
    try {
      const hash = await generateHash(filepath)
      assert.equal(hash, expectedHash('hello world'))
    } finally {
      fs.unlinkSync(filepath)
    }
  })

  it('should produce consistent hashes for identical content', async () => {
    const content = 'duplicate content'
    const file1 = createTempFile(content)
    const file2 = createTempFile(content)
    try {
      const hash1 = await generateHash(file1)
      const hash2 = await generateHash(file2)
      assert.equal(hash1, hash2)
    } finally {
      fs.unlinkSync(file1)
      fs.unlinkSync(file2)
    }
  })

  it('should produce different hashes for different content', async () => {
    const file1 = createTempFile('content A')
    const file2 = createTempFile('content B')
    try {
      const hash1 = await generateHash(file1)
      const hash2 = await generateHash(file2)
      assert.notEqual(hash1, hash2)
    } finally {
      fs.unlinkSync(file1)
      fs.unlinkSync(file2)
    }
  })

  it('should return a 64-character hex string', async () => {
    const filepath = createTempFile('test')
    try {
      const hash = await generateHash(filepath)
      assert.equal(hash.length, 64)
      assert.match(hash, /^[0-9a-f]{64}$/)
    } finally {
      fs.unlinkSync(filepath)
    }
  })

  it('should handle empty files', async () => {
    const filepath = createTempFile('')
    try {
      const hash = await generateHash(filepath)
      assert.equal(hash, expectedHash(''))
    } finally {
      fs.unlinkSync(filepath)
    }
  })

  it('should reject for non-existent files', async () => {
    await assert.rejects(
      () => generateHash('/tmp/non-existent-file-' + Date.now()),
      { code: 'ENOENT' }
    )
  })
})
