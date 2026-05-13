const express = require('express');
const Redis = require('ioredis');

const router = express.Router();

let subscriber = null;

function getSubscriber() {
  if (!subscriber) {
    subscriber = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  }
  return subscriber;
}

router.get('/:jobId', (req, res) => {
  const { jobId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  res.write(`data: ${JSON.stringify({ type: 'connected', jobId })}\n\n`);

  const sub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  const channel = `job:${jobId}:progress`;

  sub.subscribe(channel, (err) => {
    if (err) {
      console.error(`SSE subscribe error for ${jobId}:`, err);
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Subscribe failed' })}\n\n`);
    }
  });

  sub.on('message', (ch, message) => {
    if (ch === channel) {
      res.write(`data: ${message}\n\n`);

      try {
        const data = JSON.parse(message);
        if (data.type === 'complete' || data.type === 'error') {
          setTimeout(() => {
            sub.unsubscribe(channel);
            sub.disconnect();
          }, 1000);
        }
      } catch (_) {}
    }
  });

  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sub.unsubscribe(channel);
    sub.disconnect();
  });
});

module.exports = router;
