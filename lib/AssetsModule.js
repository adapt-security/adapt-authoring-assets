import AbstractApiModule from 'adapt-authoring-api'
import AbstractAsset from './AbstractAsset.js'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import ffprobe from '@ffprobe-installer/ffprobe'
import fs from 'fs/promises'
import generateHash from './utils/generateHash.js'
import LocalAsset from 'adapt-authoring-assets/lib/LocalAsset.js'
/**
 * Handling of assets
 * @memberof assets
 * @extends {AbstractApiModule}
 */
class Assetsmodule extends AbstractApiModule {
  /** @override */
  async init () {
    await super.init()
    /**
     * Store of all registered asset types
     */
    this.assetTypes = { [LocalAsset.name]: LocalAsset }

    await this.ensureLibPermissions()
    const [authored, mongodb, tags] = await this.app.waitForModule('authored', 'mongodb', 'tags')
    await mongodb.setIndex(this.collectionName, 'hash')
    await authored.registerModule(this, { accessCheck: false })
    await tags.registerModule(this)

    this.router.addMiddleware(this.fileUploadMiddleware)
    this.requestHook.tap(this.onRequest.bind(this))

    this.app.onReady().then(this.performHousekeeping.bind(this))
  }

  /** @override */
  async setValues () {
    await super.setValues()
    this.collectionName = 'assets'
    this.schemaName = 'asset'
  }

  /**
   * Registers a new asset repository as an assets store
   * @param {AbstractAsset} assetClass The AbstractAsset class
   */
  registerAssetType (assetClass) {
    const name = assetClass.name

    if (Object.getPrototypeOf(assetClass) !== AbstractAsset) throw this.app.errors.ASSET_TYPE_INVALID.setData({ name })
    if (!name) throw this.app.errors.INVALID_PARAMS.setData({ params: ['name'] })
    if (this.assetTypes[name]) throw this.app.errors.ASSET_TYPE_EXISTS.setData({ name })

    this.log('debug', 'REGISTER_ASSET_TYPE', name)
    this.assetTypes[name] = assetClass
  }

  /**
   * Creates an asset wrapper for file system operations
   * @param {object} assetData The database data
   * @returns {AbstractAsset}
   */
  createFsWrapper (assetData, ...args) {
    const AssetType = this.assetTypes[assetData.repo ?? this.getConfig('defaultAssetRepository')]
    if (!AssetType) throw this.app.errors.ASSET_TYPE_UNKNOWN.setData({ name: assetData.repo })
    return new AssetType(assetData, ...args)
  }

  /**
   * Verifies and attempts to correct execution issues with ffmpeg/ffprobe binaries
   * @returns {Promise}
   */
  async ensureLibPermissions () {
    await Promise.all([
      !this.getConfig('customFfmpegCommand') && ffmpeg.path,
      !this.getConfig('customFfprobeCommand') && ffprobe.path
    ].map(async cmd => {
      if (!cmd) return
      try {
        await fs.access(cmd, fs.constants.X_OK)
        this.log('debug', `confirmed execute permissions for ${cmd}`)
      } catch (e) {
        if (e.code !== 'EACCES') throw e
        try {
          this.log('debug', `execute permissions not allowed for ${cmd}`)
          await fs.chmod(cmd, fs.constants.S_IXUSR)
          this.log('info', `execute permissions updated for ${cmd}`)
        } catch (e) {
          throw new Error(`no execute permissions for ${cmd} (could not set manually), ${e}`)
        }
      }
    }))
    this.log('info', 'binary execution allowed')
  }

  /**
   *
   * @returns {Promise}
   */
  async performHousekeeping () {
    return Promise.allSettled((await this.find()).map(assetData => {
      return new Promise(() => {
        try {
          const asset = this.createFsWrapper(assetData)
          asset.ensureExists().catch(e => this.log('error', e))
          asset.generateThumb().catch(e => this.log('warn', e))
        } catch (e) {
          this.log('error', e)
        }
      })
    }))
  }

  /**
   * Handles incoming file uploads
   * @param {external:ExpressRequest} req
   */
  async onRequest (req) {
    if (!req.apiData.modifying || req.method === 'DELETE') {
      return
    }
    const middleware = await this.app.waitForModule('middleware')
    const opts = {
      maxFileSize: this.getConfig('maxFileSize'),
      promisify: true
    }
    const fileTypes = this.getConfig('expectedFileTypes')
    await middleware.fileUploadParser(fileTypes, opts)(req)
    await middleware.urlUploadParser(fileTypes, opts)(req)

    Object.assign(req.apiData.data, req.body)

    if (typeof req.apiData.data.tags === 'string') req.apiData.data.tags = req.apiData.data.tags.split(',')
    if (req.fileUpload) Object.assign(req.apiData.data, { file: req.fileUpload.files.file[0] })
  }

  /**
   * Serves a single asset or thumbnail
   * @param {external:ExpressRequest} req
   * @param {external:ExpressResponse} res
   * @param {function} next
   */
  async serveAssetHandler (req, res, next) {
    try {
      const assetData = await this.findOne({ _id: req.apiData.query._id })
      const asset = this.createFsWrapper(assetData)
      // fall back to the main asset when a thumb is requested but none exists (e.g. SVG)
      const wantsThumb = req.query.thumb === 'true' && asset.hasThumb
      const fileStream = await (wantsThumb ? asset.thumb.read() : asset.read())
      res.set('Content-Type', `${asset.data.type}/${asset.data.subtype}`)
      fileStream.pipe(res)
    } catch (e) {
      next(e)
    }
  }

  /** @override */
  async find (query, options, mongoOptions) {
    if (query?.type?.$in?.length === 1 && query.type.$in[0] === 'other') {
      query.type = { $nin: ['audio', 'image', 'video'] }
    }
    return super.find(query, options, mongoOptions)
  }

  /**
   * Checks for an existing asset with the same file content.
   * Uses a cheap size pre-check to avoid hashing when no candidate exists.
   * When no size match is found, returns null so the caller can defer hash
   * computation to {@link AbstractAsset#updateFile}, which handles null via
   * its precomputedHash parameter fallback.
   * @param {string} filepath Path to the uploaded file
   * @param {number} fileSize Size of the uploaded file in bytes
   * @param {object} [excludeQuery] Optional query to exclude (e.g. self on update)
   * @throws {DUPLICATE_ASSET} If a duplicate is found
   * @returns {Promise<string|null>} The computed hash if a size candidate was found, or null if not
   */
  async checkDuplicate (filepath, fileSize, excludeQuery) {
    // size pre-check: skip expensive hashing when no asset shares this file size.
    // use find() rather than findOne() — multiple assets may legitimately share a byte length.
    const sizeQuery = { size: fileSize }
    if (excludeQuery) Object.assign(sizeQuery, excludeQuery)
    const [sizeMatch] = await this.find(sizeQuery)
    if (!sizeMatch) return null
    // a candidate exists — compute hash and confirm exact duplicate
    const hash = await generateHash(filepath)
    const hashQuery = { hash }
    if (excludeQuery) Object.assign(hashQuery, excludeQuery)
    const [existing] = await this.find(hashQuery)
    if (existing) {
      this.log('debug', 'DUPLICATE_ASSET', `skipped asset creation, file matches existing asset ${existing._id} (hash: ${hash})`)
      throw this.app.errors.DUPLICATE_ASSET.setData({ hash, assetId: existing._id.toString() })
    }
    return hash
  }

  /** @override */
  async insert (data, options, mongoOptions) {
    const hash = await this.checkDuplicate(data.file.filepath, data.file.size)
    const doc = await super.insert(data, options, mongoOptions)
    try {
      const updateData = await this.createFsWrapper(doc).updateFile(data.file, hash)
      return await super.update({ _id: doc._id }, updateData, options, mongoOptions)
    } catch (e) {
      await this.delete({ _id: doc._id }, options, mongoOptions)
      throw e
    }
  }

  /** @override */
  async update (query, data, options, mongoOptions) {
    const doc = await super.update({ _id: query._id }, data, options, mongoOptions)
    if (!data.file) return doc
    const hash = await this.checkDuplicate(data.file.filepath, data.file.size, { _id: { $ne: query._id } })
    const updateData = await this.createFsWrapper(doc).updateFile(data.file, hash)
    return super.update({ _id: query._id }, updateData, options, mongoOptions)
  }

  /** @override */
  async delete (query, options, mongoOptions) {
    const doc = await super.delete(query, options, mongoOptions)
    const asset = this.createFsWrapper(doc)
    await Promise.all([asset.delete(), asset.thumb.delete()])
    return doc
  }

  /** @override */
  async deleteMany () {
    throw this.app.errors.FUNC_DISABLED.setData({ name: `${this.constructor.name}#deleteMany` })
  }
}

export default Assetsmodule
