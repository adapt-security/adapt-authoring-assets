import { App } from 'adapt-authoring-core';
import AbstractAsset from './AbstractAsset.js';
import fsCallbacks from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
/**
 * 
 */
class LocalAsset extends AbstractAsset {
  /** @override */
  static get name() {
    return 'local';
  }
  /** @override */
  get assetRoot() {
    return this.assets.getConfig('assetDir');
  }
  /** @override */
  resolvePath(filePath, basePath = this.root) {
    if(!basePath) throw App.instance.errors.INVALID_PARAMS.setData({ params: ['filePath'] });
    if(path.isAbsolute(filePath)) return filePath;
    return path.resolve(basePath, filePath);
  }
  /** @override */
   async ensureDir(dir) {
    try {
      await fsPromises.mkdir(this.resolvePath(dir), { recursive: true });
    } catch(e) {
      if(e.code !== 'EEXIST') throw e;
    }
  }
  /** @override */
  async ensureExists() {
    try {
      await fsPromises.stat(this.path);
    } catch(e) {
      if(e.code === 'ENOENT') throw App.instance.errors.NOT_FOUND.setData({ type: 'asset', id: this.path });
      throw e;
    }
  }
  /** @override */
  async generateMetadata() {
    if(!this.hasThumb) {
      return {};
    }
    return new Promise(async resolve => {
      this.ffprobe(this.path, (e, data) => {
        if(e) {
          this.assets.log('warn', 'METADATA_GEN_FAILED', this.path, e.errno, e.code, e.syscall);
          return resolve({});
        }
        const { width, height, duration } = data.streams[0];
        const metadata = {};
        if(width && height) metadata.resolution = `${width}x${height}`;  
        if(!this.isImage) metadata.duration = duration;
        resolve(metadata);
      });
    });
  }
  /** @override */
  async read() {
    await this.ensureExists(this.path);
    return fsCallbacks.createReadStream(this.path);
  }
  /** @override */
  async write(inputStream, outputPath) {
    const resolvedPath = this.resolvePath(outputPath);
    await this.ensureDir(path.dirname(resolvedPath));
    return new Promise((resolve, reject) => {
      const outputStream = fsCallbacks.createWriteStream(resolvedPath);
      outputStream.on('error', e => reject(e));
      inputStream.pipe(outputStream);
      inputStream.on('end', () => resolve());
    });
  }
  /** @override */
  async move(newPath) {
    const newResolvedPath = this.resolvePath(newPath);
    await this.ensureExists(this.path);
    await this.ensureDir(path.dirname(newResolvedPath));
    return fsPromises.rename(this.path, newResolvedPath);
  }
  /** @override */
  async delete() {
    if(!this.path) return;
    try {
      await super.delete();
      await this.ensureExists(this.path);
      return fsPromises.rm(this.path);
    } catch(e) { // don't need to throw an error if the file doesn't exist
      if(e.code !== App.instance.errors.NOT_FOUND.code) throw e;
    }
  }
}

export default LocalAsset;