import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export default function (migration) {
  migration.describe('Backfill SHA-256 hashes on existing assets so duplicate detection can match them')
  migration.runCommand(backfillHashes)
}

async function backfillHashes (db, log) {
  const assetDir = await loadAssetDir(log)
  if (!assetDir) return

  const docs = await db.collection('assets').find({ $or: [{ hash: null }, { hash: { $exists: false } }] }).toArray()
  if (!docs.length) {
    log('info', 'migrations', 'No assets without a hash')
    return
  }
  log('info', 'migrations', `Backfilling hashes for ${docs.length} asset(s)`)

  let updated = 0
  let skipped = 0
  for (const doc of docs) {
    if ((doc.repo ?? 'local') !== 'local') {
      log('warn', 'migrations', `asset ${doc._id} uses repo=${doc.repo}; only local repo is backfilled by this migration`)
      skipped++
      continue
    }
    if (!doc.path) {
      log('warn', 'migrations', `asset ${doc._id} has no path; skipping`)
      skipped++
      continue
    }
    const filepath = path.resolve(assetDir, doc.path)
    try {
      const hash = await hashFile(filepath)
      await db.collection('assets').updateOne({ _id: doc._id }, { $set: { hash } })
      updated++
    } catch (e) {
      log('warn', 'migrations', `asset ${doc._id} hash failed: ${e.message}`)
      skipped++
    }
  }
  log('info', 'migrations', `Backfilled ${updated} asset hash(es), skipped ${skipped}`)
}

async function loadAssetDir (log) {
  const env = process.env.NODE_ENV
  if (!env) {
    log('warn', 'migrations', 'NODE_ENV not set; cannot locate config to resolve assetDir')
    return null
  }
  const configPath = path.resolve(process.cwd(), 'conf', `${env}.config.js`)
  try {
    const { default: config } = await import(pathToFileURL(configPath).href)
    const assetDir = config?.['adapt-authoring-assets']?.assetDir
    if (!assetDir) {
      log('warn', 'migrations', `adapt-authoring-assets.assetDir not set in ${configPath}`)
      return null
    }
    return path.resolve(process.cwd(), assetDir)
  } catch (e) {
    log('warn', 'migrations', `failed to load ${configPath}: ${e.message}`)
    return null
  }
}

function hashFile (filepath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = createReadStream(filepath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}
