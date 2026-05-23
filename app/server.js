const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const WORKSPACE_ROOT = path.resolve(__dirname, '../content');

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/files', (req, res) => {
  try {
    const tree = [];
    if (!fs.existsSync(WORKSPACE_ROOT)) {
      return res.json(tree);
    }
    
    // Dynamically scan all top-level folders in /content/
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
    
    tree.sort((a, b) => {
      return a.name.localeCompare(b.name);
    });
    
    res.json(tree);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ error: 'Path query parameter is required' });
  }
  
  const targetPath = path.resolve(WORKSPACE_ROOT, filePath);
  
  // Security check: ensure path is within WORKSPACE_ROOT
  if (!targetPath.startsWith(WORKSPACE_ROOT)) {
    return res.status(403).json({ error: 'Access denied: Out of workspace bounds' });
  }
  
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  try {
    const content = fs.readFileSync(targetPath, 'utf-8');
    res.send(content);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function getFilesTree(dir, relativeTo) {
  const result = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    if (item.name.startsWith('.')) continue;
    const fullPath = path.join(dir, item.name);
    const relPath = path.relative(relativeTo, fullPath);
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
  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
