import { App } from 'adapt-authoring-core';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

ffmpeg.setFfprobePath(ffprobeStatic.path);
ffmpeg.setFfmpegPath(ffmpegStatic);
/**
 * 
 */
class AbstractAsset {
  /**
   * Name of the asset type
   * @type {string}
   */
  static get name() {
    return 'local';
  }
  constructor(data) {
    this.assets = App.instance.dependencyloader.instances['adapt-authoring-assets'];
    this.root = this.assetRoot;
    this.setData(data);
  }
  /**
   * Reference to the ffmpeg module
   * @type {*}
   */
  get ffmpeg() {
    return ffmpeg;
  }
  /**
   * Reference to the ffprobe module
   * @type {*}
   */
  get ffprobe() {
    return ffmpeg.ffprobe;
  }
  /**
   * The root location for this asset type
   * @type {string}
   */
  get assetRoot() {
    throw App.instance.errors.FUNC_NOT_OVERRIDDEN.setData({ name: `${this.constructor.name}#assetRoot` });
  }
  /**
   * Access to the thumbnail asset
   * @return {LocalAsset} The thumb asset
   */
   get thumb() {
    if(!this._thumb) {
      const id = this.data?._id?.toString() ?? this.data.path.replace(path.extname(this.data.path), '');
      this._thumb = this.assets.createAsset({ repo: 'local', path: id + this.assets.getConfig('thumbnailExt'), root: this.assets.getConfig('thumbnailDir') });
    }
    return this._thumb;
  }
  setData(data) {
    if(data.root) {
      this.root = data.root;
      delete data.root;
    }
    if(!this.data) this.data = {};
    Object.assign(this.data, JSON.parse(JSON.stringify(data)));
    if(this.data.path) this.data.path = this.resolvePath(this.data.path);
    return this.data;
  }
  /**
   * Generate a thumbnail for an existing asset
   * @param {object} options Optional settings
   * @param {string} options.regenerate Will regenerate the thumbnail if one already exists
   */
  async generateThumb(options = { regenerate: false }) {
    await this.thumb.ensureDir(this.assets.getConfig('thumbnailDir'));
    try {
      await this.thumb.ensureExists();
      if(!options.regenerate) return;
    } catch(e) {
      // thumb doesn't exist
    }
    return new Promise(async (resolve, reject) => {
      const ff = this.ffmpeg(await this.read())
        .on('error', e => reject(e))
        .on('end', () => resolve())
        .size(`${this.assets.getConfig('thumbnailWidth')}x?`);

      if(this.data.type === 'video') ff.seek(10);

      ff.save(this.thumb.resolvePath(this.thumb.data.path));
    });
  }
  /**
   * Performs the required file operations when uploading/replacing an asset
   * @param {FormidableFile} file Uploaded file data
   * @returns {object} The update data
   */
  async updateFile(file) {
    const [type, subtype] = file.mimetype.split('/');
    // remove old file and set new path
    await this.delete();
    this.setData({ 
      path: `${this.data._id}.${subtype}`, 
      hasThumb: type === 'image' || type === 'video' 
    });
    // perform filesystem operations
    const localAsset = this.assets.createAsset({ repo: 'local', path: file.filepath });
    await this.write(await localAsset.read(), this.data.path);
    await localAsset.delete();
    if(this.data.hasThumb) await this.generateThumb({ regenerate: true });
    // generate new data
    return this.setData({
      repo: this.data.repo, 
      size: file.size,
      subtype, 
      type,
      ...await this.generateMetadata(localAsset)
    });
  }
  /**
   * Resolves a relative path to the root directory. Must be overridden by subclasses.
   * @param {string} filePath 
   * @returns {string} The resolved path
   */
  resolvePath(filePath) {
  }
  /**
   * Ensures a directory exists, creating it if not. Must be overridden by subclasses.
   * @param {string} dir Directory to check
   * @return {Promise}
   */
  async ensureDir(dir) {
  }
  /**
   * Checks if a file exists. Must be overridden by subclasses.
   * @return {Promise} Rejects if not found
   */
  async ensureExists() {
  }
  /**
   * Sets metadata on an existing asset
   * @typedef
   * @return {AssetMetadata} The metadata
   */
  async generateMetadata() {
  }
  /**
   * Read a file. Must be overridden by subclasses.
   * @return {external:stream~Readable}
   */
  async read() {
  }
  /**
   * Write a file to the repository. Must be overridden by subclasses.
   * @param {external:stream~Readable} inputStream The file read stream
   * @param {string} outputPath Path at which to store the file
   * @return {Promise}
   */
  async write(inputStream, outputPath) {
  }
  /**
   * 
   * @param {string} newPath New path for file
   * @return {Promise}
   */
  async move(newPath) {
  }
  /**
   * Removes a file from the repository
   * @return {Promise}
   */
  async delete() {
    if(this.data.hasThumb) await this.thumb.delete();
  }
}

export default AbstractAsset;