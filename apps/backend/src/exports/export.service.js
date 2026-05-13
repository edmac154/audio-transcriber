const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const STORAGE_BASE = process.env.STORAGE_BASE || './storage';

function getExportPath(jobId, filename) {
  const dir = path.join(STORAGE_BASE, 'exports', jobId);
  return path.join(dir, filename);
}

function listExports(jobId) {
  const dir = path.join(STORAGE_BASE, 'exports', jobId);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir).map(name => {
    const filePath = path.join(dir, name);
    const stats = fs.statSync(filePath);
    return {
      name,
      path: filePath,
      size: stats.size,
      created: stats.birthtime
    };
  });
}

function createExportBundle(jobId, files) {
  return new Promise((resolve, reject) => {
    const bundleDir = path.join(STORAGE_BASE, 'exports', jobId);
    fs.mkdirSync(bundleDir, { recursive: true });
    const zipPath = path.join(bundleDir, 'export_bundle.zip');

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => {
      resolve({
        path: zipPath,
        filename: 'export_bundle.zip',
        size: archive.pointer()
      });
    });

    archive.on('error', reject);
    archive.pipe(output);

    for (const file of files) {
      if (fs.existsSync(file.path)) {
        archive.file(file.path, { name: file.name || path.basename(file.path) });
      }
    }

    archive.finalize();
  });
}

module.exports = {
  getExportPath,
  listExports,
  createExportBundle,
  STORAGE_BASE
};
