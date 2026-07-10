/**
 * Backfills the generic `_access` grant on existing assets. Assets predate the access model
 * (they were a global, scope-gated pool with no per-asset sharing), so there is no legacy
 * field to derive from — they are made public by default, preserving the prior "everyone sees
 * every asset" behaviour. New assets get `_access.public: true` from the schema default.
 *
 * Idempotent: only touches assets that don't yet carry `_access.public`. `_access.users` is
 * preserved if already present (e.g. seeded by the usergroups groups backfill), else defaulted.
 */
export default function (migration) {
  migration.describe('Backfill _access.public=true / _access.users=[] on existing assets (public by default)')
  migration.runCommand(backfillAssetAccess)
}

async function backfillAssetAccess (db, log) {
  const res = await db.collection('assets').updateMany(
    { '_access.public': { $exists: false } },
    [{
      $set: {
        '_access.public': true,
        '_access.users': { $ifNull: ['$_access.users', []] }
      }
    }]
  )
  log('info', 'migrations', `Backfilled _access on ${res.modifiedCount} asset(s)`)
}
