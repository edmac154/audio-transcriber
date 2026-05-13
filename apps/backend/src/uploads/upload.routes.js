const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { handleUpload } = require('./upload.controller');

const STORAGE_BASE = process.env.STORAGE_BASE || './storage';
const UPLOAD_DIR = path.join(STORAGE_BASE, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const router = express.Router();

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave',
      'audio/x-wav', 'audio/flac', 'audio/ogg', 'audio/aac',
      'audio/mp4', 'audio/x-m4a', 'video/mp4', 'audio/webm'
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(mp3|wav|flac|ogg|aac|m4a|mp4|webm|wma)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported audio format'), false);
    }
  }
});

router.post('/audio', upload.single('audio'), handleUpload);

module.exports = router;
