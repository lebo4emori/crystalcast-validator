const fs = require('fs')
const archiver = require('archiver');
const promisify = require('util').promisify
const statPromise = promisify(fs.stat)
const logger = require('../common/logger.js')

/**
 * Parses files into Json
 */
class FileArchiver {

    /**
     * Read the file size in megabytes
     * @param {*} file the filepath
     */
    static async readFileSizeInMb(file) {
        return statPromise(file).then(stats => {
            return stats.size / (1024 * 1024);
        }).catch(err => {
            logger.error('reading file stats: ' + err);
        })
    }

    /**
     * Write file as zip
     * @param {*} file the file
     * @param {*} fileName the file name
     * @param {*} zipPath the zip file path
     */
    static async writeAsZip(file, fileName, zipPath) {
        return new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', {
                zlib: { level: 9 } // Best compression level
            });
            archive.on('error', function (err) {
                reject(err)
            });
            archive.pipe(output);
            archive.append(fs.createReadStream(file), { name: fileName })
            archive.finalize();
            resolve(true);
        }).catch(err=>{
            reject(err);
        })
    }
}

module.exports = FileArchiver