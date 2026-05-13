const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function normalizeAudio(input, output, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(output), { recursive: true });

    const ffmpeg = spawn('ffmpeg', [
      '-i', input,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      '-y',
      output
    ]);

    ffmpeg.stderr.on('data', (data) => {
      const line = data.toString();
      if (onProgress) onProgress(line);
    });

    ffmpeg.on('error', (err) => reject(new Error(`ffmpeg failed: ${err.message}`)));
    ffmpeg.on('close', (code) => {
      if (code !== 0) reject(new Error(`ffmpeg exited with code ${code}`));
      else resolve(output);
    });
  });
}

module.exports = { normalizeAudio };
