const { Worker } = require('bullmq');
const Redis = require('ioredis');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const STORAGE_BASE = process.env.STORAGE_BASE || '/app/storage';
const DEMUCS_MODEL = process.env.DEMUCS_MODEL || 'htdemucs';

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});

const pubClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

console.log('Demucs worker online');

function publishProgress(jobId, data) {
  pubClient.publish(`job:${jobId}:progress`, JSON.stringify(data));
}

function parseDemucsStderr(line) {
  const percentMatch = line.match(/(\d+)%\|/);
  if (percentMatch) {
    return { type: 'progress', percent: parseInt(percentMatch[1], 10) };
  }

  const separatingMatch = line.match(/Separating track/i);
  if (separatingMatch) {
    return { type: 'stage', stage: 'separating' };
  }

  return null;
}

function runDemucs(inputPath, outputDir, options = {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(outputDir, { recursive: true });

    const args = [
      '-n', options.model || DEMUCS_MODEL,
      '-o', outputDir,
      '--two-stems' in options ? null : null,
      inputPath
    ].filter(Boolean);

    console.log(`Running: demucs ${args.join(' ')}`);

    const proc = spawn('demucs', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stderrBuf = '';

    proc.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = parseDemucsStderr(line);
        if (!parsed) continue;

        if (parsed.type === 'progress' && options.onProgress) {
          options.onProgress(parsed.percent);
        }
      }
    });

    proc.stdout.on('data', () => {});

    proc.on('error', (err) => {
      reject(new Error(`demucs failed to start: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`demucs exited with code ${code}`));
        return;
      }

      const baseName = path.basename(inputPath, path.extname(inputPath));
      const stemsDir = path.join(outputDir, options.model || DEMUCS_MODEL, baseName);

      const stems = {};
      const stemNames = ['vocals', 'drums', 'bass', 'other'];

      for (const name of stemNames) {
        const wavPath = path.join(stemsDir, `${name}.wav`);
        if (fs.existsSync(wavPath)) {
          stems[name] = wavPath;
        }
      }

      const instrumentalPath = path.join(stemsDir, 'no_vocals.wav');
      if (fs.existsSync(instrumentalPath)) {
        stems.instrumental = instrumentalPath;
      }

      resolve({
        stemsDir,
        stems,
        stemCount: Object.keys(stems).length
      });
    });
  });
}

function copyStemsToExports(stems, exportDir) {
  fs.mkdirSync(exportDir, { recursive: true });
  const copied = {};

  for (const [name, srcPath] of Object.entries(stems)) {
    const destPath = path.join(exportDir, `${name}.wav`);
    fs.copyFileSync(srcPath, destPath);
    copied[name] = destPath;
  }

  if (stems.drums && stems.bass && stems.other && !stems.instrumental) {
    try {
      const instrumentalPath = path.join(exportDir, 'instrumental.wav');
      copied.instrumental = instrumentalPath;
    } catch (_) {}
  }

  return copied;
}

const worker = new Worker(
  'demucs',
  async (job) => {
    const { jobId, filePath } = job.data;
    const startTime = Date.now();

    console.log(`[${jobId}] Starting stem separation: ${filePath}`);

    publishProgress(jobId, {
      type: 'stage',
      stage: 'separating_stems',
      progress: 0
    });

    await job.updateProgress(5);

    const outputDir = path.join(STORAGE_BASE, 'stems');

    const result = await runDemucs(filePath, outputDir, {
      onProgress: (percent) => {
        const mapped = 5 + Math.round(percent * 0.85);
        job.updateProgress(mapped);

        const elapsed = (Date.now() - startTime) / 1000;
        const rate = elapsed / Math.max(mapped, 1);
        const eta = Math.round(rate * (100 - mapped));

        publishProgress(jobId, {
          type: 'progress',
          progress: mapped,
          eta,
          elapsed: Math.round(elapsed),
          stage: 'separating_stems'
        });
      }
    });

    console.log(`[${jobId}] Separation complete: ${result.stemCount} stems`);

    const exportDir = path.join(STORAGE_BASE, 'exports', jobId);
    const exportedStems = copyStemsToExports(result.stems, exportDir);

    await job.updateProgress(100);

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    publishProgress(jobId, {
      type: 'complete',
      progress: 100,
      elapsed,
      stemCount: result.stemCount,
      stage: 'stems_complete'
    });

    return {
      jobId,
      stems: exportedStems,
      stemCount: result.stemCount,
      elapsed
    };
  },
  {
    connection,
    concurrency: 1
  }
);

worker.on('completed', (job, result) => {
  console.log(`[${result.jobId}] Demucs job completed in ${result.elapsed}s`);
});

worker.on('failed', (job, err) => {
  const jobId = job?.data?.jobId || 'unknown';
  console.error(`[${jobId}] Demucs job failed:`, err.message);
  publishProgress(jobId, {
    type: 'error',
    error: err.message,
    stage: 'failed'
  });
});

process.on('SIGTERM', async () => {
  console.log('Demucs worker shutting down...');
  await worker.close();
  process.exit(0);
});
