import crypto from 'node:crypto'
import fs from 'node:fs'

/**
 * Computes a SHA-256 hex digest for a file
 * @param {string} filepath Path to the file
 * @returns {Promise<string>} The hex digest
 */
export default function generateHash (filepath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filepath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}
