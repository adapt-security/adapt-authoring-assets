/**
 * Migration script to compute SHA-256 hashes for existing asset records.
 *
 * Run manually from the adapt-authoring root:
 *   node assets/lib/migrate-hashes.js
 *
 * Requires a running MongoDB instance with the app's configuration.
 */
import { App } from 'adapt-authoring-core'
import generateHash from './utils/generateHash.js'

async function migrate () {
  const app = App.instance
  await app.onReady()

  const assets = await app.waitForModule('assets')
  const docs = await assets.find({ $or: [{ hash: null }, { hash: { $exists: false } }] })

  console.log(`Found ${docs.length} assets without a hash`)

  const duplicates = new Map()
  let updated = 0
  let errors = 0

  for (const doc of docs) {
    try {
      const asset = assets.createFsWrapper(doc)
      await asset.ensureExists()
      const hash = await generateHash(asset.path)
      await assets.update({ _id: doc._id }, { hash }, { schemaOptions: { ignoreReadOnly: true } })

      if (duplicates.has(hash)) {
        duplicates.get(hash).push(doc._id)
      } else {
        duplicates.set(hash, [doc._id])
      }
      updated++
    } catch (e) {
      console.error(`Failed to hash asset ${doc._id}: ${e.message}`)
      errors++
    }
  }

  const dupeEntries = [...duplicates.entries()].filter(([, ids]) => ids.length > 1)
  if (dupeEntries.length) {
    console.log(`\nDuplicate hashes found (${dupeEntries.length}):`)
    for (const [hash, ids] of dupeEntries) {
      console.log(`  ${hash}: ${ids.join(', ')}`)
    }
  }

  console.log(`\nDone. Updated: ${updated}, Errors: ${errors}`)
  process.exit(0)
}

migrate().catch(e => {
  console.error(e)
  process.exit(1)
})
