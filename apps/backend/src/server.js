require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const uploadRoutes = require('./uploads/upload.routes');
const sseRoutes = require('./sse/sse.routes');
const jobRoutes = require('./jobs/job.routes');
const exportRoutes = require('./exports/export.routes');
const { generateTranscriptDocx } = require('./docx/docx.service');
const { getJob, updateJob } = require('./jobs/job.manager');

const STORAGE_BASE = process.env.STORAGE_BASE || './storage';

['uploads', 'normalized', 'transcripts', 'exports', 'waveforms', 'stems'].forEach(dir => {
  fs.mkdirSync(path.join(STORAGE_BASE, dir), { recursive: true });
});

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => {
  res.json({
    status: 'ok',
    service: 'audio-transcriber-backend',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/uploads', uploadRoutes);
app.use('/api/sse', sseRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/exports', exportRoutes);

app.post('/api/jobs/:jobId/generate-docx', async (req, res) => {
  const { jobId } = req.params;
  const job = getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const transcriptPath = path.join(STORAGE_BASE, 'transcripts', jobId, 'transcript.json');

  if (!fs.existsSync(transcriptPath)) {
    return res.status(404).json({ error: 'Transcript not yet available' });
  }

  const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));

  const result = await generateTranscriptDocx(transcript, {
    title: req.body?.title || `Transcripción - ${job.originalName || job.filename}`,
    filename: 'transcript',
    language: transcript.language || 'unknown',
    duration: job.metadata?.format?.duration
      ? `${Math.round(parseFloat(job.metadata.format.duration))}s`
      : null,
    outputDir: path.join(STORAGE_BASE, 'exports', jobId)
  });

  updateJob(jobId, {
    results: {
      ...job.results,
      docx: {
        path: result.path,
        filename: result.filename,
        downloadUrl: `/api/exports/${jobId}/download/${result.filename}`
      }
    }
  });

  res.json({
    success: true,
    docx: {
      filename: result.filename,
      size: result.size,
      segmentCount: result.segmentCount,
      downloadUrl: `/api/exports/${jobId}/download/${result.filename}`
    }
  });
});

app.post('/api/jobs/:jobId/bundle', async (req, res) => {
  const { jobId } = req.params;
  const job = getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const { createExportBundle } = require('./exports/export.service');
  const { listExports } = require('./exports/export.service');

  const files = listExports(jobId);
  if (files.length === 0) {
    return res.status(404).json({ error: 'No exports available' });
  }

  const nonZipFiles = files.filter(f => !f.name.endsWith('.zip'));
  const bundle = await createExportBundle(jobId, nonZipFiles);

  res.json({
    success: true,
    bundle: {
      filename: bundle.filename,
      size: bundle.size,
      downloadUrl: `/api/exports/${jobId}/download/${bundle.filename}`
    }
  });
});

app.use('/storage', express.static(path.resolve(STORAGE_BASE)));

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Audio Transcriber backend online on port ${PORT}`);
});
