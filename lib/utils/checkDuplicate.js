/**
 * Check whether a file matches an existing asset by content hash.
 *
 * Pure helper extracted from AssetsModule#checkDuplicate so it can be unit-tested
 * without booting the app. Pulls in collaborators (find, hash, error factory) via
 * the deps argument.
 *
 * @param {String} filepath Path to the file to check
 * @param {Number} fileSize Size of the file in bytes
 * @param {Object} [excludeQuery] Optional Mongo query fragment to exclude (e.g. self on update)
 * @param {Object} deps
 * @param {Function} deps.findFn Async (query) => Array<Asset>
 * @param {Function} deps.generateHash Async (filepath) => String hash
 * @param {Function} deps.makeDuplicateError Async ({ hash, assetId }) => Error to throw when a match is found
 * @returns {Promise<String|null>} Hash if a size candidate existed, null otherwise
 * @throws Result of makeDuplicateError when a hash match is found
 */
export default async function checkDuplicate (filepath, fileSize, excludeQuery, { findFn, generateHash, makeDuplicateError }) {
  // existence checks use find()+[0] not findOne() — assets can share a byte length
  const sizeQuery = { size: fileSize }
  if (excludeQuery) Object.assign(sizeQuery, excludeQuery)
  const [sizeMatch] = await findFn(sizeQuery)
  if (!sizeMatch) return null

  const hash = await generateHash(filepath)
  const hashQuery = { hash }
  if (excludeQuery) Object.assign(hashQuery, excludeQuery)
  const [existing] = await findFn(hashQuery)
  if (existing) {
    throw makeDuplicateError({ hash, assetId: existing._id.toString() })
  }
  return hash
}
