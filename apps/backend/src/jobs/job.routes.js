const express = require('express');
const { getJob, getAllJobs } = require('./job.manager');

const router = express.Router();

router.get('/', (req, res) => {
  const jobs = getAllJobs();
  res.json({ jobs });
});

router.get('/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json({ job });
});

router.get('/:jobId/status', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    stages: job.stages,
    results: job.results
  });
});

module.exports = router;
