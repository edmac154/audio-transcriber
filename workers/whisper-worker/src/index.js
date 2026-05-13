const { Worker } = require('bullmq');
const Redis = require('ioredis');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const WHISPER_BIN = process.env.WHISPER_BIN || 'whisper-cli';
const WHISPER_MODEL = process.env.WHISPER_MODEL || '/app/models/ggml-base.bin';
const STORAGE_BASE = process.env.STORAGE_BASE || '/app/storage';

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});

const pubClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

console.log('Whisper worker online');

function publishProgress(jobId, data) {
  pubClient.publish(`job:${jobId}:progress`, JSON.stringify(data));
}

function parseStderrLine(line) {
  const progressMatch = line.match(/whisper_full_with_state:.*progress\s*=\s*(\d+)%/);
  if (progressMatch) {
    return { type: 'progress', percent: parseInt(progressMatch[1], 10) };
  }

  const segmentMatch = line.match(/\[\s*(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\s*\]\s*(.*)/);
  if (segmentMatch) {
    return {
      type: 'segment',
      from: segmentMatch[1],
      to: segmentMatch[2],
      text: segmentMatch[3].trim()
    };
  }

  return null;
}

function parseWhisperJson(jsonPath) {
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const data = JSON.parse(raw);

  const segments = (data.transcription || []).map(seg => ({
    start: seg.offsets?.from ?? 0,
    end: seg.offsets?.to ?? 0,
    text: (seg.text || '').trim()
  }));

  return {
    language: data.result?.language || 'unknown',
    segments,
    fullText: segments.map(s => s.text).join(' ')
  };
}

function normalizeAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      '-y',
      outputPath
    ];

    const proc = spawn('ffmpeg', args);

    proc.on('error', (err) => reject(new Error(`ffmpeg failed: ${err.message}`)));
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`ffmpeg exited with code ${code}`));
      else resolve(outputPath);
    });
  });
}

function runWhisperCli(wavPath, outputDir, options = {}) {
  return new Promise((resolve, reject) => {
    const baseName = path.basename(wavPath, path.extname(wavPath));

    fs.mkdirSync(outputDir, { recursive: true });

    const args = [
      '-m', WHISPER_MODEL,
      '-f', wavPath,
      '-oj',
      '-otxt',
      '-of', path.join(outputDir, baseName),
      '-pp',
      '-t', String(options.threads || 4)
    ];

    if (options.language && options.language !== 'auto') {
      args.push('-l', options.language);
    }

    console.log(`Running: ${WHISPER_BIN} ${args.join(' ')}`);

    const proc = spawn(WHISPER_BIN, args);

    let stderrBuf = '';
    const segments = [];

    proc.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = parseStderrLine(line);
        if (!parsed) continue;

        if (parsed.type === 'progress' && options.onProgress) {
          options.onProgress(parsed.percent);
        }
        if (parsed.type === 'segment') {
          segments.push(parsed);
          if (options.onSegment) {
            options.onSegment(parsed);
          }
        }
      }
    });

    proc.stdout.on('data', () => {});

    proc.on('error', (err) => {
      reject(new Error(`whisper-cli failed to start: ${err.message}`));
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

const worker = new Worker(
  'transcript',
  async (job) => {
    const { jobId, filePath, language, threads } = job.data;
    const startTime = Date.now();

    console.log(`[${jobId}] Starting transcription: ${filePath}`);

    publishProgress(jobId, {
      type: 'stage',
      stage: 'normalizing',
      progress: 0
    });

    await job.updateProgress(5);

    const normalizedDir = path.join(STORAGE_BASE, 'normalized');
    fs.mkdirSync(normalizedDir, { recursive: true });
    const baseName = path.basename(filePath, path.extname(filePath));
    const wavPath = path.join(normalizedDir, `${baseName}.wav`);

    await normalizeAudio(filePath, wavPath);
    console.log(`[${jobId}] Audio normalized to WAV`);

    publishProgress(jobId, {
      type: 'stage',
      stage: 'transcribing',
      progress: 10
    });

    await job.updateProgress(10);

    const transcriptDir = path.join(STORAGE_BASE, 'transcripts', jobId);
    let segmentCount = 0;

    const result = await runWhisperCli(wavPath, transcriptDir, {
      language,
      threads,
      onProgress: (percent) => {
        const mapped = 10 + Math.round(percent * 0.8);
        job.updateProgress(mapped);

        const elapsed = (Date.now() - startTime) / 1000;
        const rate = elapsed / Math.max(mapped, 1);
        const eta = Math.round(rate * (100 - mapped));

        publishProgress(jobId, {
          type: 'progress',
          progress: mapped,
          eta,
          elapsed: Math.round(elapsed),
          segmentCount,
          stage: 'transcribing'
        });
      },
      onSegment: (seg) => {
        segmentCount++;
        publishProgress(jobId, {
          type: 'segment',
          segmentCount,
          text: seg.text
        });
      }
    });

    console.log(`[${jobId}] Transcription complete: ${result.segmentCount} segments`);

    const transcriptJsonPath = path.join(transcriptDir, 'transcript.json');
    fs.writeFileSync(transcriptJsonPath, JSON.stringify(result.transcript, null, 2));

    await job.updateProgress(95);

    publishProgress(jobId, {
      type: 'stage',
      stage: 'finalizing',
      progress: 95
    });

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    publishProgress(jobId, {
      type: 'complete',
      progress: 100,
      elapsed,
      segmentCount: result.segmentCount,
      language: result.language
    });

    await job.updateProgress(100);

    return {
      jobId,
      transcriptDir,
      jsonPath: result.jsonPath,
      txtPath: result.txtPath,
      segmentCount: result.segmentCount,
      language: result.language,
      elapsed
    };
  },
  {
    connection,
    concurrency: 1,
    limiter: { max: 1, duration: 1000 }
  }
);

worker.on('completed', (job, result) => {
  console.log(`[${result.jobId}] Job completed in ${result.elapsed}s`);
});

worker.on('failed', (job, err) => {
  const jobId = job?.data?.jobId || 'unknown';
  console.error(`[${jobId}] Job failed:`, err.message);
  publishProgress(jobId, {
    type: 'error',
    error: err.message,
    stage: 'failed'
  });
});

process.on('SIGTERM', async () => {
  console.log('Whisper worker shutting down...');
  await worker.close();
  process.exit(0);
});
