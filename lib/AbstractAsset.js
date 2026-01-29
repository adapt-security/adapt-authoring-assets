import { App, Utils } from 'adapt-authoring-core'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import ffprobe from '@ffprobe-installer/ffprobe'
import mime from 'mime'
import path from 'path'

/**
 * Base class for handling an asset
 * @memberof assets
 */
class AbstractAsset {
  /**
   * Name of the asset type
   * @type {string}
   */
  static get name () {
    return 'local'
  }

  constructor (data) {
    this.assets = App.instance.dependencyloader.instances['adapt-authoring-assets']
    this.root = this.assetRoot
    this.setData(data)
  }

  /**
   * The root location for this asset type
   * @type {string}
   */
  get assetRoot () {
    throw App.instance.errors.FUNC_NOT_OVERRIDDEN.setData({ name: `${this.constructor.name}#assetRoot` })
  }

  /**
   * The asset path
   * @type {string}
   */
  get path () {
    return this.data.path ? this.resolvePath(this.data.path) : undefined
  }

  /**
   * Whether the asset has a thumbnail
   */
  get hasThumb () {
    return this.data.hasThumb
  }

  /**
   * Whether the asset is an audio file
   */
  get isAudio () {
    return this.data.type === 'audio'
  }

  /**
   * Whether the asset is an image file
   */
  get isImage () {
    return this.data.type === 'image'
  }

  /**
   * Whether the asset is an video file
   */
  get isVideo () {
    return this.data.type === 'video'
  }

  /**
   * Access to the thumbnail asset
   * @return {LocalAsset} The thumb asset
   */
  get thumb () {
    if (!this._thumb) {
      const id = this.data?._id?.toString() ?? this.path.replace(path.extname(this.path), '')
      this._thumb = this.assets.createFsWrapper({
        repo: 'local',
        path: id + this.assets.getConfig('thumbnailExt'),
        root: this.assets.getConfig('thumbnailDir')
      })
    }
    return this._thumb
  }

  setData (data) {
    if (data.root) {
      this.root = data.root
      delete data.root
    }
    if (!this.data) this.data = {}
    Object.assign(this.data, JSON.parse(JSON.stringify(data)))
    return this.data
  }

  /**
   * Returns the expected file type. Respects the originally uploaded file extension
   * @param {FormidableFile} file File data
   * @returns {String}
   */
  getFileExtension (file) {
    const parts = file?.originalFilename?.split('.')
    if (!parts || parts.length === 1) throw App.instance.errors.PARSE_EXT.setData({ file: file.originalFilename })
    return parts.pop()
  }

  /**
   * Generate a thumbnail for an existing asset
   * @param {object} options Optional settings
   * @param {string} options.regenerate Will regenerate the thumbnail if one already exists
   */
  async generateThumb (options = { regenerate: false }) {
    if (!this.hasThumb) {
      return
    }
    await this.thumb.ensureDir(this.assets.getConfig('thumbnailDir'))
    try {
      await this.thumb.ensureExists()
      if (!options.regenerate) return
    } catch (e) {
      // thumb doesn't exist, continue
    }
    /**
     * ffmpeg doesn't work with streams in all cases, so we need to
     * temporarily download the asset locally before processing
     */
    const { default: LocalAsset } = await import('./LocalAsset.js')
    const cwd = this.thumb.dirname
    const tempAsset = new LocalAsset({ path: path.join(cwd, `TEMP_${this.filename}`) })
    await tempAsset.write(await this.read(), tempAsset.path)

    const cmd = this.assets.getConfig('customFfmpegCommand') ?? ffmpeg.path
    const args = [
      `-i ${tempAsset.filename}`,
      `-vf scale=${this.assets.getConfig('thumbnailWidth')}:-1`,
      '-vframes 1',
      '-update 1',
      this.isVideo ? '-ss 00:00:05.000' : '',
      '-hide_banner',
      '-loglevel error',
      this.thumb.filename
    ]
    this.assets.log('debug', 'FFMPEG', cmd, args)
    this.assets.log('verbose', 'FFMPEG', 'cwd:', cwd)

    try {
      await Utils.spawn({ cmd, args, cwd })
    } catch (e) {
      throw App.instance.errors.FFMPEG.setData({ message: e, command: [cmd, ...args].join(' '), cwd })
    } finally {
      await tempAsset.delete()
    }
  }

  /**
   * Performs the required file operations when uploading/replacing an asset
   * @param {FormidableFile} file Uploaded file data
   * @returns {object} The update data
   */
  async updateFile (file) {
    const [type, subtype] = mime.getType(file.originalFilename).split('/')
    // remove old file and set new path
    await this.delete()
    this.setData({
      path: `${this.data._id}.${this.getFileExtension(file)}`,
      repo: this.data.repo,
      size: file.size,
      subtype,
      type,
      hasThumb: (type === 'image' && subtype !== 'svg+xml') || type === 'video'
    })
    // perform filesystem operations
    const localAsset = this.assets.createFsWrapper({ repo: 'local', path: file.filepath })
    await this.write(await localAsset.read(), this.path)
    await localAsset.delete()
    await this.generateThumb({ regenerate: true })
    // generate metadata
    return this.setData(await this.generateMetadata(localAsset))
  }

  /**
   * Sets metadata on an existing asset
   * @typedef
   * @return {AssetMetadata} The metadata
   */
  async generateMetadata () {
    if (!this.hasThumb) { // if there's no thumb, then it's the wrong type of file for calculating the extra metadata
      return {}
    }
    const { default: LocalAsset } = await import('./LocalAsset.js')
    const cwd = App.instance.getConfig('tempDir')
    const tempAsset = new LocalAsset({ path: path.join(cwd, this.filename) })
    await tempAsset.write(await this.read(), tempAsset.path)

    const cmd = this.assets.getConfig('customFfprobeCommand') ?? ffprobe.path
    const args = [
      `-i ${this.filename}`,
      '-loglevel error',
      '-print_format json',
      '-show_format',
      '-show_streams'
    ]
    this.assets.log('debug', 'FFPROBE', cmd, args)
    this.assets.log('verbose', 'FFPROBE', 'cwd:', cwd)

    let streams
    let format
    try {
      const outputData = JSON.parse(await Utils.spawn({ cmd, args, cwd }))
      format = outputData.format
      streams = outputData.streams
    } catch (e) {
      throw App.instance.errors.FFPROBE.setData({ error: e, command: [cmd, ...args].join(' '), cwd })
    } finally {
      await tempAsset.delete()
    }
    const streamData = streams.find(s => s.codec_type === 'video')
    this.assets.log('verbose', 'FFPROBE', { ...streamData, format })
    const metadata = {}
    if (streamData.width && streamData.height) metadata.resolution = `${streamData.width}x${streamData.height}`
    if (this.isVideo) metadata.duration = Math.floor(Number(streamData.duration))
    metadata.size = Number(format.size)

    return metadata
  }

  /**
   * Resolves a relative path to the root directory. Must be overridden by subclasses.
   * @param {string} filePath
   * @returns {string} The resolved path
   */
  resolvePath (filePath) {
  }

  /**
   * Ensures a directory exists, creating it if not. Must be overridden by subclasses.
   * @param {string} dir Directory to check
   * @return {Promise}
   */
  async ensureDir (dir) {
  }

  /**
   * Checks if a file exists. Must be overridden by subclasses.
   * @return {Promise} Rejects if not found
   */
  async ensureExists () {
  }

  /**
   * Read a file. Must be overridden by subclasses.
   * @return {external:stream~Readable}
   */
  async read () {
  }

  /**
   * Write a file to the repository. Must be overridden by subclasses.
   * @param {external:stream~Readable} inputStream The file read stream
   * @param {string} outputPath Path at which to store the file
   * @return {Promise}
   */
  async write (inputStream, outputPath) {
  }

  /**
   *
   * @param {string} newPath New path for file
   * @return {Promise}
   */
  async move (newPath) {
  }

  /**
   * Removes a file from the repository
   * @return {Promise}
   */
  async delete () {
    if (this.hasThumb) await this.thumb.delete()
  }
}

export default AbstractAsset
