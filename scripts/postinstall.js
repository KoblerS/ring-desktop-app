#!/usr/bin/env node
/**
 * Post-install script that runs all necessary patches.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Run binary-data patch
require('./patch-binary-data.js');

// Fix ffmpeg-for-homebridge symlink on Windows
// npm creates symlinks for file: dependencies, but Windows often can't create them
// without admin privileges. This ensures the stub is properly copied.
const ffmpegDest = path.join(__dirname, '..', 'node_modules', 'ffmpeg-for-homebridge');
const ffmpegSrc = path.join(__dirname, '..', 'stubs', 'ffmpeg-for-homebridge');

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

try {
  const stats = fs.lstatSync(ffmpegDest);
  
  // Check if it's a symlink (which might be broken on Windows)
  if (stats.isSymbolicLink()) {
    // Try to read the symlink target
    try {
      fs.readdirSync(ffmpegDest);
      console.log('[ffmpeg-for-homebridge] Symlink is valid');
    } catch (e) {
      // Symlink is broken, replace with actual copy
      console.log('[ffmpeg-for-homebridge] Fixing broken symlink...');
      fs.unlinkSync(ffmpegDest);
      copyDirSync(ffmpegSrc, ffmpegDest);
      console.log('[ffmpeg-for-homebridge] Copied stub successfully');
    }
  } else {
    console.log('[ffmpeg-for-homebridge] Already a directory (not symlink)');
  }
} catch (e) {
  // ffmpegDest doesn't exist at all
  if (e.code === 'ENOENT') {
    console.log('[ffmpeg-for-homebridge] Creating stub directory...');
    copyDirSync(ffmpegSrc, ffmpegDest);
    console.log('[ffmpeg-for-homebridge] Copied stub successfully');
  } else {
    console.error('[ffmpeg-for-homebridge] Error:', e.message);
  }
}
