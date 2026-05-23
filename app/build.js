const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '../content');
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const PUBLIC_CONTENT_DIR = path.join(PUBLIC_DIR, 'content');

// Helper to recursively scan folders
function getFilesTree(dir, relativeTo) {
  const result = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const item of items) {
    if (item.name.startsWith('.')) continue;
    
    const fullPath = path.join(dir, item.name);
    // Relative path for the frontend (using forward slashes)
    const relPath = path.relative(relativeTo, fullPath).split(path.sep).join('/');
    
    if (item.isDirectory()) {
      const children = getFilesTree(fullPath, relativeTo);
      if (children.length > 0) {
        result.push({
          name: item.name,
          type: 'directory',
          path: relPath,
          children: children
        });
      }
    } else if (item.isFile() && item.name.endsWith('.md')) {
      result.push({
        name: item.name,
        type: 'file',
        path: relPath
      });
    }
  }
  
  // Sort: directories first, then alphabetically
  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// 1. Generate Tree
console.log('Scanning content directory...');
const tree = [];
if (fs.existsSync(WORKSPACE_ROOT)) {
  const items = fs.readdirSync(WORKSPACE_ROOT, { withFileTypes: true });
  for (const item of items) {
    if (item.isDirectory() && !item.name.startsWith('.')) {
      const fullPath = path.join(WORKSPACE_ROOT, item.name);
      const children = getFilesTree(fullPath, WORKSPACE_ROOT);
      
      tree.push({
        name: item.name,
        type: 'directory',
        path: item.name,
        children: children
      });
    }
  }
}

tree.sort((a, b) => {
  return a.name.localeCompare(b.name);
});

// Save tree.json
const treeOutputPath = path.join(PUBLIC_DIR, 'tree.json');
fs.writeFileSync(treeOutputPath, JSON.stringify(tree, null, 2));
console.log(`Generated ${treeOutputPath}`);

// 2. Copy Markdown files to public/content
console.log('Copying markdown files to public/content...');
if (fs.existsSync(PUBLIC_CONTENT_DIR)) {
  fs.rmSync(PUBLIC_CONTENT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(PUBLIC_CONTENT_DIR, { recursive: true });

function copyMarkdownFiles(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;
  const items = fs.readdirSync(sourceDir, { withFileTypes: true });
  
  for (const item of items) {
    if (item.name.startsWith('.')) continue;
    
    const srcPath = path.join(sourceDir, item.name);
    const destPath = path.join(targetDir, item.name);
    
    if (item.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyMarkdownFiles(srcPath, destPath);
    } else if (item.isFile() && item.name.endsWith('.md')) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyMarkdownFiles(WORKSPACE_ROOT, PUBLIC_CONTENT_DIR);
console.log('Build complete! Your static site is ready in the public/ folder.');
