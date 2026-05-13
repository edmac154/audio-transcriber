const { Worker } = require('bullmq');
const Redis = require('ioredis');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const STORAGE_BASE = process.env.STORAGE_BASE || '/app/storage';

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});

const pubClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

console.log('MIDI worker online');

function publishProgress(jobId, data) {
  pubClient.publish(`job:${jobId}:progress`, JSON.stringify(data));
}

function runBasicPitch(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(outputDir, { recursive: true });

    const args = [
      '-m', 'basic_pitch',
      inputPath,
      outputDir
    ];

    console.log(`Running: python3 ${args.join(' ')}`);

    const proc = spawn('python3', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stderrBuf = '';

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrBuf += text;
      console.log(`[basic-pitch stderr] ${text.trim()}`);
    });

    proc.stdout.on('data', (chunk) => {
      console.log(`[basic-pitch stdout] ${chunk.toString().trim()}`);
    });

    proc.on('error', (err) => {
      reject(new Error(`basic-pitch failed to start: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`basic-pitch exited with code ${code}: ${stderrBuf}`));
        return;
      }

      const baseName = path.basename(inputPath, path.extname(inputPath));
      const midiPath = path.join(outputDir, `${baseName}_basic_pitch.mid`);
      const altMidiPath = path.join(outputDir, `${baseName}.mid`);

      let foundMidi = null;
      if (fs.existsSync(midiPath)) {
        foundMidi = midiPath;
      } else if (fs.existsSync(altMidiPath)) {
        foundMidi = altMidiPath;
      } else {
        const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.mid') || f.endsWith('.midi'));
        if (files.length > 0) {
          foundMidi = path.join(outputDir, files[0]);
        }
      }

      if (!foundMidi) {
        reject(new Error('No MIDI file produced by basic-pitch'));
        return;
      }

      resolve({
        midiPath: foundMidi,
        filename: path.basename(foundMidi)
      });
    });
  });
}

const worker = new Worker(
  'midi',
  async (job) => {
    const { jobId, filePath } = job.data;
    const startTime = Date.now();

    console.log(`[${jobId}] Starting MIDI extraction: ${filePath}`);

    publishProgress(jobId, {
      type: 'stage',
      stage: 'extracting_midi',
      progress: 0
    });

    await job.updateProgress(10);

    publishProgress(jobId, {
      type: 'progress',
      progress: 10,
      stage: 'extracting_midi'
    });

    const midiOutputDir = path.join(STORAGE_BASE, 'midi', jobId);

    const vocalsPath = path.join(STORAGE_BASE, 'exports', jobId, 'vocals.wav');
    const inputForMidi = fs.existsSync(vocalsPath) ? vocalsPath : filePath;

    console.log(`[${jobId}] Using input: ${inputForMidi}`);

    await job.updateProgress(20);
    publishProgress(jobId, {
      type: 'progress',
      progress: 20,
      stage: 'extracting_midi'
    });

    const result = await runBasicPitch(inputForMidi, midiOutputDir);

    console.log(`[${jobId}] MIDI extracted: ${result.filename}`);

    const exportDir = path.join(STORAGE_BASE, 'exports', jobId);
    fs.mkdirSync(exportDir, { recursive: true });
    const exportMidiPath = path.join(exportDir, 'melody.mid');
    fs.copyFileSync(result.midiPath, exportMidiPath);

    await job.updateProgress(100);

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    publishProgress(jobId, {
      type: 'complete',
      progress: 100,
      elapsed,
      stage: 'midi_complete'
    });

    return {
      jobId,
      midiPath: exportMidiPath,
      filename: 'melody.mid',
      elapsed
    };
  },
  {
    connection,
    concurrency: 1
  }
);

worker.on('completed', (job, result) => {
  console.log(`[${result.jobId}] MIDI job completed in ${result.elapsed}s`);
});

worker.on('failed', (job, err) => {
  const jobId = job?.data?.jobId || 'unknown';
  console.error(`[${jobId}] MIDI job failed:`, err.message);
  publishProgress(jobId, {
    type: 'error',
    error: err.message,
    stage: 'failed'
  });
});

process.on('SIGTERM', async () => {
  console.log('MIDI worker shutting down...');
  await worker.close();
  process.exit(0);
});
