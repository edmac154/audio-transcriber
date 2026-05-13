
const { spawn } = require('child_process');

function probeAudio(filePath) {

  return new Promise((resolve, reject) => {

    const ffprobe = spawn('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath
    ]);

    let output = '';

    ffprobe.stdout.on('data', data => {
      output += data.toString();
    });

    ffprobe.on('close', code => {

      if (code !== 0) {
        reject(new Error('ffprobe failed'));
        return;
      }

      resolve(JSON.parse(output));
    });
  });
}

module.exports = {
  probeAudio
};
