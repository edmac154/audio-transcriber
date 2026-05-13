const express = require('express');
const path = require('path');
const fs = require('fs');
const { getJob } = require('../jobs/job.manager');
const { listExports, createExportBundle, STORAGE_BASE } = require('./export.service');

const router = express.Router();

router.get('/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const files = listExports(jobId);
  res.json({ jobId, files });
});

router.get('/:jobId/download/:filename', (req, res) => {
  const { jobId, filename } = req.params;
  const filePath = path.join(STORAGE_BASE, 'exports', jobId, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.mid': 'audio/midi',
    '.midi': 'audio/midi',
    '.json': 'application/json',
    '.zip': 'application/zip',
    '.png': 'image/png',
    '.txt': 'text/plain'
  };
  res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');

  fs.createReadStream(filePath).pipe(res);
});

router.post('/:jobId/bundle', async (req, res) => {
  const { jobId } = req.params;
  const job = getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const files = listExports(jobId);
  if (files.length === 0) {
    return res.status(404).json({ error: 'No exports available' });
  }

  const bundle = await createExportBundle(jobId, files);
  res.json({
    jobId,
    bundle: {
      filename: bundle.filename,
      size: bundle.size,
      downloadUrl: `/api/exports/${jobId}/download/${bundle.filename}`
    }
  });
});

router.get('/:jobId/transcript', (req, res) => {
  const { jobId } = req.params;
  const transcriptPath = path.join(STORAGE_BASE, 'transcripts', jobId, 'transcript.json');

  if (!fs.existsSync(transcriptPath)) {
    return res.status(404).json({ error: 'Transcript not found' });
  }

  const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));
  res.json({ jobId, transcript });
});

module.exports = router;
