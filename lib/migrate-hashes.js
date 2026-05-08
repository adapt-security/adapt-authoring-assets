/**
 * Migration script to compute SHA-256 hashes for existing asset records
 * and merge any duplicates by updating all references to point to the
 * oldest asset in each duplicate group.
 *
 * Run manually from the adapt-authoring root:
 *   node assets/lib/migrate-hashes.js [--dry-run]
 *
 * Pass --dry-run to report what would change without writing to the DB.
 * Requires a running MongoDB instance with the app's configuration.
 */
import { App } from 'adapt-authoring-core'
import generateHash from './utils/generateHash.js'

const dryRun = process.argv.includes('--dry-run')

const assetPredicate = field => {
  return field?._backboneForms?.type === 'Asset' || field?._backboneForms === 'Asset'
}

async function migrate () {
  const app = App.instance
  await app.onReady()

  if (dryRun) console.log('DRY RUN — no changes will be written\n')

  const assets = await app.waitForModule('assets')
  const docs = await assets.find({ $or: [{ hash: null }, { hash: { $exists: false } }] })

  console.log(`Found ${docs.length} assets without a hash`)

  const hashGroups = new Map()
  let updated = 0
  let errors = 0

  for (const doc of docs) {
    try {
      const asset = assets.createFsWrapper(doc)
      await asset.ensureExists()
      const hash = await generateHash(asset.path)
      if (!dryRun) {
        await assets.update({ _id: doc._id }, { hash }, { schemaOptions: { ignoreReadOnly: true } })
      }

      if (hashGroups.has(hash)) {
        hashGroups.get(hash).push(doc)
      } else {
        hashGroups.set(hash, [doc])
      }
      updated++
    } catch (e) {
      console.error(`Failed to hash asset ${doc._id}: ${e.message}`)
      errors++
    }
  }

  console.log(`\nHashing complete. Updated: ${updated}, Errors: ${errors}`)

  const dupeGroups = [...hashGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([hash, group]) => {
      group.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      return { hash, keeper: group[0], victims: group.slice(1) }
    })

  if (!dupeGroups.length) {
    console.log('No duplicate assets to merge')
    process.exit(0)
  }

  console.log(`\nFound ${dupeGroups.length} duplicate groups to merge`)

  const victimMap = new Map()
  for (const { keeper, victims } of dupeGroups) {
    for (const victim of victims) {
      victimMap.set(victim._id.toString(), keeper._id.toString())
    }
  }

  await updateAssetReferences(app, victimMap)
  await deleteVictimAssets(assets, victimMap)

  console.log('\nDuplicate merge complete')
  process.exit(0)
}

async function updateAssetReferences (app, victimMap) {
  const jsonschema = await app.waitForModule('jsonschema')
  const mongodb = await app.waitForModule('mongodb')

  const batchSize = 1000
  const schemaCache = new Map()
  let totalUpdated = 0

  for (const moduleInstance of Object.values(app.dependencyloader.instances)) {
    const { collectionName } = moduleInstance
    if (!collectionName) continue

    let skip = 0

    while (true) {
      const docs = await mongodb.find(collectionName, {}, { skip, limit: batchSize })
      if (!docs || !docs.length) break

      for (const doc of docs) {
        let schemaName
        try {
          schemaName = typeof moduleInstance.getSchemaName === 'function'
            ? await moduleInstance.getSchemaName(doc)
            : moduleInstance.schemaName
        } catch {
          schemaName = moduleInstance.schemaName
        }
        if (!schemaName) continue

        let schema = schemaCache.get(schemaName)
        if (!schema) {
          try {
            schema = await jsonschema.getSchema(schemaName)
            schemaCache.set(schemaName, schema)
          } catch {
            continue
          }
        }

        const matches = schema.walk(doc, assetPredicate)
        const updates = {}

        for (const match of matches) {
          const value = match.value?.toString()
          if (victimMap.has(value)) {
            const mongoPath = match.path.replace(/\//g, '.')
            updates[mongoPath] = victimMap.get(value)
          }
        }

        if (Object.keys(updates).length) {
          if (!dryRun) {
            await mongodb.update(collectionName, { _id: doc._id }, { $set: updates })
          }
          console.log(`  ${dryRun ? 'Would update' : 'Updated'} ${collectionName} ${doc._id}: ${Object.keys(updates).join(', ')}`)
          totalUpdated++
        }
      }

      skip += docs.length
    }
  }

  console.log(`Updated ${totalUpdated} documents`)
}

async function deleteVictimAssets (assets, victimMap) {
  let deleted = 0
  for (const victimId of victimMap.keys()) {
    try {
      if (!dryRun) await assets.delete({ _id: victimId })
      console.log(`  ${dryRun ? 'Would delete' : 'Deleted'} duplicate asset ${victimId}`)
      deleted++
    } catch (e) {
      console.error(`  Failed to delete asset ${victimId}: ${e.message}`)
    }
  }
  console.log(`${dryRun ? 'Would delete' : 'Deleted'} ${deleted} duplicate assets`)
}

migrate().catch(e => {
  console.error(e)
  process.exit(1)
})
