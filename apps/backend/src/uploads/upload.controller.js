const path = require('path');
const { probeAudio } = require('../ffmpeg/ffprobe.service');
const { generateWaveform } = require('../ffmpeg/waveform.service');
const {
  createJob,
  updateJob,
  enqueueTranscript,
  enqueueDemucs,
  enqueueMidi
} = require('../jobs/job.manager');

const STORAGE_BASE = process.env.STORAGE_BASE || './storage';

async function handleUpload(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  const filePath = req.file.path;
  const originalName = req.file.originalname;
  const filename = req.file.filename;

  let metadata = {};
  try {
    metadata = await probeAudio(filePath);
  } catch (err) {
    console.error('FFprobe failed:', err.message);
  }

  const job = createJob({
    filename,
    originalName,
    filePath
  });

  updateJob(job.id, {
    status: 'queued',
    metadata
  });

  const tasks = req.body?.tasks || ['transcribe'];

  const queued = [];

  if (tasks.includes('transcribe')) {
    await enqueueTranscript(job.id, filePath, {
      language: req.body?.language || 'auto'
    });
    queued.push('transcribe');
  }

  if (tasks.includes('separate')) {
    await enqueueDemucs(job.id, filePath);
    queued.push('separate');
  }

  if (tasks.includes('midi')) {
    await enqueueMidi(job.id, filePath);
    queued.push('midi');
  }

  try {
    const waveformPath = path.join(STORAGE_BASE, 'waveforms', `${job.id}.png`);
    generateWaveform(filePath, waveformPath);
  } catch (_) {}

  res.json({
    success: true,
    jobId: job.id,
    filename,
    originalName,
    metadata: metadata?.format || {},
    tasks: queued,
    sseUrl: `/api/sse/${job.id}`,
    statusUrl: `/api/jobs/${job.id}/status`
  });
}

module.exports = { handleUpload };
