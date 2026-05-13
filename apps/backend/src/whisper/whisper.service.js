const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { parseWhisperStderr, parseWhisperJson } = require('./whisper.parser');

const WHISPER_BIN = process.env.WHISPER_BIN || 'whisper-cli';
const WHISPER_MODEL = process.env.WHISPER_MODEL || '/app/models/ggml-base.bin';

function runWhisper(inputPath, outputDir, options = {}) {
  return new Promise((resolve, reject) => {
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const language = options.language || 'auto';

    fs.mkdirSync(outputDir, { recursive: true });

    const args = [
      '-m', WHISPER_MODEL,
      '-f', inputPath,
      '-oj',
      '-otxt',
      '-of', path.join(outputDir, baseName),
      '-pp',
      '-t', String(options.threads || 4)
    ];

    if (language !== 'auto') {
      args.push('-l', language);
    }

    const proc = spawn(WHISPER_BIN, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stderrBuffer = '';
    const segments = [];

    proc.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();

      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;

        const parsed = parseWhisperStderr(line);

        if (parsed.type === 'progress' && options.onProgress) {
          options.onProgress(parsed.data.percent);
        }

        if (parsed.type === 'segment') {
          segments.push(parsed.data);
          if (options.onSegment) {
            options.onSegment(parsed.data);
          }
        }

        if (parsed.type === 'loading' && options.onStage) {
          options.onStage('loading_model');
        }
      }
    });

    proc.stdout.on('data', () => {});

    proc.on('error', (err) => {
      reject(new Error(`whisper-cli not found or failed to start: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`whisper-cli exited with code ${code}`));
        return;
      }

      const jsonPath = path.join(outputDir, `${baseName}.json`);
      const txtPath = path.join(outputDir, `${baseName}.txt`);

      let transcript;
      if (fs.existsSync(jsonPath)) {
        transcript = parseWhisperJson(jsonPath);
      } else {
        transcript = {
          language: 'unknown',
          segments: segments.map(s => ({
            start: s.from,
            end: s.to,
            text: s.text
          })),
          fullText: segments.map(s => s.text).join(' ')
        };
      }

      resolve({
        jsonPath: fs.existsSync(jsonPath) ? jsonPath : null,
        txtPath: fs.existsSync(txtPath) ? txtPath : null,
        transcript,
        segmentCount: transcript.segments.length,
        language: transcript.language
      });
    });
  });
}

module.exports = { runWhisper };
