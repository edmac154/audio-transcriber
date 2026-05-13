const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function generateWaveform(input, output) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(output), { recursive: true });

    const ffmpeg = spawn('ffmpeg', [
      '-i', input,
      '-filter_complex', 'showwavespic=s=1280x240:colors=#22c55e',
      '-frames:v', '1',
      '-y',
      output
    ]);

    ffmpeg.on('error', (err) => reject(new Error(`ffmpeg waveform failed: ${err.message}`)));
    ffmpeg.on('close', (code) => {
      if (code !== 0) reject(new Error(`ffmpeg waveform exited with code ${code}`));
      else resolve(output);
    });
  });
}

module.exports = { generateWaveform };
