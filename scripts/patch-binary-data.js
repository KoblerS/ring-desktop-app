#!/usr/bin/env node
/**
 * Patches @shinyoshiaki/binary-data to work in Electron asar archives.
 * 
 * The package uses a non-standard nested node_modules structure that breaks
 * in asar archives. This patch flattens the structure by moving files out
 * of src/node_modules/ into src/ and updating ALL require paths throughout.
 */

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'node_modules', '@shinyoshiaki', 'binary-data', 'src');
const indexPath = path.join(srcDir, 'index.js');
const nestedNodeModules = path.join(srcDir, 'node_modules');

if (!fs.existsSync(indexPath)) {
  console.log('[@shinyoshiaki/binary-data] Package not found, skipping patch');
  process.exit(0);
}

/**
 * Calculate the relative path prefix from a file to the src directory
 */
function getRelativePrefix(filePath) {
  const relative = path.relative(path.dirname(filePath), srcDir);
  if (relative === '') return './';
  return relative.split(path.sep).join('/') + '/';
}

/**
 * Patch require statements in a file to use proper relative paths
 */
function patchFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const prefix = getRelativePrefix(filePath);
  
  const original = content;
  
  // Replace bare module requires with relative paths
  content = content
    .replace(/require\('lib\//g, `require('${prefix}lib/`)
    .replace(/require\('types\//g, `require('${prefix}types/`)
    .replace(/require\('internal\//g, `require('${prefix}internal/`)
    // Also fix any already-patched but wrong paths
    .replace(/require\('\.\/node_modules\/lib\//g, `require('${prefix}lib/`)
    .replace(/require\('\.\/node_modules\/types\//g, `require('${prefix}types/`)
    .replace(/require\('\.\/node_modules\/internal\//g, `require('${prefix}internal/`);
  
  if (content !== original) {
    fs.writeFileSync(filePath, content);
    return true;
  }
  return false;
}

/**
 * Recursively find all .js files in a directory
 */
function findJsFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findJsFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

// Step 1: Flatten the nested node_modules structure if it exists
if (fs.existsSync(nestedNodeModules)) {
  console.log('[@shinyoshiaki/binary-data] Flattening nested node_modules structure...');
  
  const dirsToMove = ['lib', 'types', 'internal'];
  for (const dir of dirsToMove) {
    const srcPath = path.join(nestedNodeModules, dir);
    const destPath = path.join(srcDir, dir);
    
    if (fs.existsSync(srcPath)) {
      if (fs.existsSync(destPath)) {
        fs.rmSync(destPath, { recursive: true });
      }
      fs.renameSync(srcPath, destPath);
      console.log(`  Moved ${dir}/`);
    }
  }
  
  try {
    fs.rmSync(nestedNodeModules, { recursive: true });
    console.log('  Removed empty node_modules/');
  } catch (e) {
    // Ignore
  }
}

// Step 2: Patch ALL JavaScript files to use proper relative paths
console.log('[@shinyoshiaki/binary-data] Patching require paths in all files...');

const jsFiles = findJsFiles(srcDir);
let patchedCount = 0;

for (const file of jsFiles) {
  if (patchFile(file)) {
    patchedCount++;
    const relativePath = path.relative(srcDir, file);
    console.log(`  Patched ${relativePath}`);
  }
}

if (patchedCount === 0) {
  console.log('[@shinyoshiaki/binary-data] Already patched');
} else {
  console.log(`[@shinyoshiaki/binary-data] Patched ${patchedCount} files successfully`);
}
