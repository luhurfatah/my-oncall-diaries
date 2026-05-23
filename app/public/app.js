// State Variables
let fileTreeData = [];
let flatFilesList = [];
let currentFileIndex = -1;
let currentActivePath = '';
let currentFontSize = 1.2;
let isWideMode = false;

function applyWidthMode(overrideWide) {
  if (overrideWide || isWideMode) {
    document.documentElement.style.setProperty('--reading-max-width', '1200px');
  } else {
    document.documentElement.style.setProperty('--reading-max-width', '740px');
  }
}

// DOM Elements
const elements = {
  logoBtn: document.getElementById('logo-btn'),
  fileTree: document.getElementById('file-tree'),
  markdownContainer: document.getElementById('markdown-container'),
  welcomeScreen: document.getElementById('welcome-screen'),
  searchInput: document.getElementById('search-input'),
  searchClear: document.getElementById('search-clear'),
  breadcrumbs: document.getElementById('breadcrumbs'),
  themeToggle: document.getElementById('theme-toggle'),
  sidebar: document.querySelector('.sidebar'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  menuToggle: document.getElementById('menu-toggle'),
  progressBar: document.getElementById('progress-bar'),
  contentBody: document.querySelector('.content-body'),
  docNavigation: document.getElementById('doc-navigation'),
  prevDocBtn: document.getElementById('prev-doc-btn'),
  prevDocTitle: document.getElementById('prev-doc-title'),
  nextDocBtn: document.getElementById('next-doc-btn'),
  nextDocTitle: document.getElementById('next-doc-title'),
  fontDecrease: document.getElementById('font-decrease'),
  fontIncrease: document.getElementById('font-increase'),
  widthToggle: document.getElementById('width-toggle')
};

// Initial Setup
document.addEventListener('DOMContentLoaded', () => {
  fetchFileTree();
  setupEventListeners();
});

// Configure Marked.js for safe custom rendering
marked.setOptions({
  headerIds: true,
  gfm: true,
  breaks: true
});

// Event Listeners
function setupEventListeners() {
  // Home / Dashboard link
  elements.logoBtn.addEventListener('click', () => {
    elements.welcomeScreen.classList.remove('hidden');
    elements.markdownContainer.classList.add('hidden');
    elements.docNavigation.classList.add('hidden');
    currentActivePath = '';
    updateSidebarActiveState();
    elements.breadcrumbs.innerHTML = '<span>Dashboard</span>';
    if (window.innerWidth <= 768) {
      elements.sidebar.classList.remove('open');
    }
  });

  // Theme Toggle (default: light mode = no class; dark mode = .dark-mode)
  elements.themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    const icon = elements.themeToggle.querySelector('i');
    if (document.body.classList.contains('dark-mode')) {
      icon.className = 'fa-solid fa-sun';
    } else {
      icon.className = 'fa-solid fa-moon';
    }
  });

  elements.fontDecrease.addEventListener('click', () => {
    currentFontSize = Math.max(0.8, currentFontSize - 0.1);
    document.documentElement.style.setProperty('--dynamic-font-size', `${currentFontSize}rem`);
  });

  elements.fontIncrease.addEventListener('click', () => {
    currentFontSize = Math.min(2.5, currentFontSize + 0.1);
    document.documentElement.style.setProperty('--dynamic-font-size', `${currentFontSize}rem`);
  });

  elements.widthToggle.addEventListener('click', () => {
    isWideMode = !isWideMode;
    applyWidthMode();
  });

  // Search Filter
  elements.searchInput.addEventListener('input', handleSearch);
  elements.searchClear.addEventListener('click', () => {
    elements.searchInput.value = '';
    elements.searchClear.classList.add('hidden');
    renderFileTree(fileTreeData);
  });

  // Unified sidebar toggle (desktop: collapse/expand | mobile: slide in/out)
  function toggleSidebar() {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      elements.sidebar.classList.toggle('open');
    } else {
      elements.sidebar.classList.toggle('collapsed');
      const icon = elements.sidebarToggle.querySelector('i');
      icon.className = elements.sidebar.classList.contains('collapsed')
        ? 'fa-solid fa-angles-right'
        : 'fa-solid fa-angles-left';
    }
  }

  elements.sidebarToggle.addEventListener('click', toggleSidebar);
  elements.menuToggle.addEventListener('click', toggleSidebar);

  // Close sidebar on clicking outside (mobile only)
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768) {
      if (!elements.sidebar.contains(e.target) && !elements.menuToggle.contains(e.target)) {
        elements.sidebar.classList.remove('open');
      }
    }
  });

  // Scroll Progress Bar
  elements.contentBody.addEventListener('scroll', () => {
    const scrollTop = elements.contentBody.scrollTop;
    const scrollHeight = elements.contentBody.scrollHeight - elements.contentBody.clientHeight;
    const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
    elements.progressBar.style.width = `${progress}%`;
  });

  // Document Navigation Clicks
  elements.prevDocBtn.addEventListener('click', () => {
    if (currentFileIndex > 0) {
      loadDocument(flatFilesList[currentFileIndex - 1]);
    }
  });

  elements.nextDocBtn.addEventListener('click', () => {
    if (currentFileIndex < flatFilesList.length - 1) {
      loadDocument(flatFilesList[currentFileIndex + 1]);
    }
  });
}

// Fetch File Tree from static JSON
async function fetchFileTree() {
  try {
    const response = await fetch('tree.json');
    if (!response.ok) throw new Error('Failed to load file list');
    fileTreeData = await response.json();
    
    // Flatten files list for next/previous navigation
    buildFlatFilesList(fileTreeData);
    
    // Render the Sidebar File Tree
    renderFileTree(fileTreeData);
  } catch (error) {
    elements.fileTree.innerHTML = `<div class="error-text"><i class="fa-solid fa-circle-exclamation"></i> Error loading file tree.</div>`;
    console.error(error);
  }
}

// Flatten files list recursively
function buildFlatFilesList(nodes) {
  flatFilesList = [];
  function recurse(list) {
    for (const node of list) {
      if (node.type === 'file') {
        flatFilesList.push(node);
      } else if (node.type === 'directory' && node.children) {
        recurse(node.children);
      }
    }
  }
  recurse(nodes);
}

// Render Sidebar File Tree
function renderFileTree(data) {
  elements.fileTree.innerHTML = '';
  const rootUl = document.createElement('ul');
  rootUl.style.listStyle = 'none';
  
  data.forEach(node => {
    rootUl.appendChild(createTreeNode(node));
  });
  
  elements.fileTree.appendChild(rootUl);
}

// Create a DOM tree node for the file tree
function createTreeNode(node, depth = 0) {
  const li = document.createElement('li');
  li.className = 'tree-node';

  const label = document.createElement('div');
  label.className = 'tree-label';
  if (node.path === currentActivePath) {
    label.classList.add('active');
  }

  // Depth-based indentation: 14px base + 26px per nested level
  const BASE_PAD = 14;
  const STEP_PAD = 26;
  label.style.paddingLeft = `${BASE_PAD + depth * STEP_PAD}px`;

  // Icon and Text setup
  if (node.type === 'directory') {
    // Top-level categories get a distinct section-header style
    if (depth === 0) {
      label.classList.add('tree-category');
    }

    const caret = document.createElement('i');
    caret.className = 'fa-solid fa-caret-right caret-icon rotated';
    label.appendChild(caret);

    const folderIcon = document.createElement('i');
    folderIcon.className = depth === 0 ? 'fa-solid fa-layer-group folder-icon' : 'fa-solid fa-folder folder-icon';
    label.appendChild(folderIcon);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = node.name;
    label.appendChild(nameSpan);

    li.appendChild(label);

    // Create children sublist
    const childrenUl = document.createElement('ul');
    childrenUl.className = 'tree-children';
    childrenUl.style.listStyle = 'none';

    node.children.forEach(child => {
      childrenUl.appendChild(createTreeNode(child, depth + 1));
    });

    li.appendChild(childrenUl);

    // Toggle folder collapse on click
    label.addEventListener('click', (e) => {
      e.stopPropagation();
      childrenUl.classList.toggle('collapsed');
      caret.classList.toggle('rotated');
    });
  } else {
    const fileIcon = document.createElement('i');
    fileIcon.className = 'fa-regular fa-file-lines file-icon';
    label.appendChild(fileIcon);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = node.name;
    label.appendChild(nameSpan);

    li.appendChild(label);

    // Load document on click
    label.addEventListener('click', (e) => {
      e.stopPropagation();
      loadDocument(node);
      if (window.innerWidth <= 768) {
        elements.sidebar.classList.remove('open');
      }
    });
  }

  return li;
}

// Fetch and render single Markdown file
async function loadDocument(node) {
  try {
    elements.welcomeScreen.classList.add('hidden');
    elements.markdownContainer.classList.remove('hidden');
    elements.markdownContainer.innerHTML = `<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading content...</div>`;
    
    currentActivePath = node.path;
    updateSidebarActiveState();
    
    // Auto-wide mode for CV
    if (node.path.toLowerCase().includes('cv')) {
      applyWidthMode(true);
    } else {
      applyWidthMode(false);
    }
    
    const response = await fetch(`content/${node.path}`);
    if (!response.ok) throw new Error('Failed to fetch file content');
    const markdown = await response.text();
    
    // Parse Markdown to HTML
    let htmlContent = marked.parse(markdown);
    elements.markdownContainer.innerHTML = htmlContent;
    
    // Auto-generate IDs for all headings to support TOC links
    const headings = elements.markdownContainer.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach(heading => {
      if (!heading.id) {
        // Convert text to lowercase, replace spaces and special chars with hyphens
        const id = heading.textContent.trim().toLowerCase()
          .replace(/[^\w\s-]/g, '') // Remove punctuation
          .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
          .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
        heading.id = id;
      }
    });

    // Apply CV styling if the document is from the CV folder
    if (node.path.toLowerCase().includes('99-cv') || node.path.toLowerCase().includes('cv')) {
      elements.markdownContainer.classList.add('cv');
    } else {
      elements.markdownContainer.classList.remove('cv');
    }
    
    // Set breadcrumbs
    updateBreadcrumbs(node.path);
    
    // Highlight Code blocks and insert custom copy buttons
    processCodeBlocks();
    Prism.highlightAll();
    
    // Intercept internal markdown links
    interceptMarkdownLinks(node.path);
    
    // Update Navigation links (Previous/Next)
    updateDocNavigation(node);
    
    // Scroll reading area to top
    elements.contentBody.scrollTop = 0;
    elements.progressBar.style.width = '0%';
  } catch (error) {
    elements.markdownContainer.innerHTML = `<div class="error-text"><i class="fa-solid fa-triangle-exclamation"></i> Error loading file content.</div>`;
    console.error(error);
  }
}

// Update Active class in Sidebar
function updateSidebarActiveState() {
  const treeLabels = document.querySelectorAll('.tree-label');
  treeLabels.forEach(label => label.classList.remove('active'));
  
  // Find node matching current path and mark active
  const matchingLabel = Array.from(treeLabels).find(label => {
    const parentNode = label.parentElement;
    // Walk down and check child/file matches if any, or find by exact match
    return label.querySelector('span').textContent === currentActivePath.split('/').pop();
  });
  
  // Handled at generation time but clean up manually on click
  fetchFileTree();
}

// Setup Breadcrumb headers
function updateBreadcrumbs(filePath) {
  elements.breadcrumbs.innerHTML = '';
  const parts = filePath.split('/');
  
  parts.forEach((part, index) => {
    const span = document.createElement('span');
    span.textContent = part;
    elements.breadcrumbs.appendChild(span);
    
    if (index < parts.length - 1) {
      const sep = document.createElement('span');
      sep.className = 'separator';
      sep.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
      elements.breadcrumbs.appendChild(sep);
    }
  });
}

// Add language bars and copy buttons on code blocks
function processCodeBlocks() {
  const preBlocks = elements.markdownContainer.querySelectorAll('pre');
  preBlocks.forEach(pre => {
    const code = pre.querySelector('code');
    if (!code) return;
    
    // Extract language name
    let lang = 'text';
    code.classList.forEach(cls => {
      if (cls.startsWith('language-')) {
        lang = cls.replace('language-', '');
      }
    });
    
    // Create custom wrapper and header bar
    const container = document.createElement('div');
    container.className = 'code-container';
    
    const header = document.createElement('div');
    header.className = 'code-header';
    header.innerHTML = `
      <span><i class="fa-solid fa-code"></i> ${lang.toUpperCase()}</span>
      <button class="copy-btn"><i class="fa-regular fa-copy"></i> Copy</button>
    `;
    
    pre.parentNode.insertBefore(container, pre);
    container.appendChild(header);
    container.appendChild(pre);
    
    // Hook copy clipboard event
    const copyBtn = header.querySelector('.copy-btn');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(code.textContent).then(() => {
        copyBtn.innerHTML = `<i class="fa-solid fa-check"></i> Copied!`;
        copyBtn.style.color = 'var(--accent)';
        setTimeout(() => {
          copyBtn.innerHTML = `<i class="fa-regular fa-copy"></i> Copy`;
          copyBtn.style.color = '';
        }, 2000);
      });
    });
  });
}

// Update Footer Prev/Next buttons
function updateDocNavigation(currentNode) {
  currentFileIndex = flatFilesList.findIndex(f => f.path === currentNode.path);
  
  if (currentFileIndex === -1) {
    elements.docNavigation.classList.add('hidden');
    return;
  }
  
  elements.docNavigation.classList.remove('hidden');
  
  // Previous Document Button setup
  if (currentFileIndex > 0) {
    elements.prevDocBtn.classList.remove('hidden');
    elements.prevDocTitle.textContent = flatFilesList[currentFileIndex - 1].name;
  } else {
    elements.prevDocBtn.classList.add('hidden');
  }
  
  // Next Document Button setup
  if (currentFileIndex < flatFilesList.length - 1) {
    elements.nextDocBtn.classList.remove('hidden');
    elements.nextDocTitle.textContent = flatFilesList[currentFileIndex + 1].name;
  } else {
    elements.nextDocBtn.classList.add('hidden');
  }
}

// Search filter implementation
function handleSearch(e) {
  const query = e.target.value.toLowerCase().trim();
  if (query.length > 0) {
    elements.searchClear.classList.remove('hidden');
    
    // Filter tree matching query
    const filteredTree = filterTree(fileTreeData, query);
    renderFileTree(filteredTree);
    
    // Keep matches expanded
    const childrenUl = document.querySelectorAll('.tree-children');
    childrenUl.forEach(ul => {
      ul.classList.remove('collapsed');
    });
    const carets = document.querySelectorAll('.caret-icon');
    carets.forEach(c => {
      c.classList.add('rotated');
    });
  } else {
    elements.searchClear.classList.add('hidden');
    renderFileTree(fileTreeData);
  }
}

// Recursively filter tree data matching the search string
function filterTree(nodes, query) {
  const result = [];
  
  nodes.forEach(node => {
    if (node.type === 'file' && node.name.toLowerCase().includes(query)) {
      result.push(node);
    } else if (node.type === 'directory') {
      const childrenMatches = filterTree(node.children, query);
      if (childrenMatches.length > 0 || node.name.toLowerCase().includes(query)) {
        result.push({
          ...node,
          children: childrenMatches
        });
      }
    }
  });
  
  return result;
}

// Intercept internal markdown links to prevent page reload
function interceptMarkdownLinks(currentPath) {
  const links = elements.markdownContainer.querySelectorAll('a');
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (!href) return;
    
    if (href.startsWith('http')) {
      link.setAttribute('target', '_blank'); // Open external links in new tab
      return;
    }
    
    // Handle internal TOC anchor links
    if (href.startsWith('#')) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = href.substring(1);
        const targetElement = document.getElementById(targetId);
        if (targetElement) {
          // Scroll the content body smoothly to the target heading
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
      return;
    }
    
    // Only intercept links to other markdown files
    if (href.endsWith('.md')) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        try {
          // Resolve relative path using the URL API (dummy base needed for relative resolution)
          const base = new URL(`http://dummy.com/${currentPath}`);
          const resolvedPath = new URL(href, base).pathname.substring(1);
          
          // Find target file in flatFilesList
          const targetNode = flatFilesList.find(f => f.path === resolvedPath);
          if (targetNode) {
            loadDocument(targetNode);
          } else {
            console.warn('Link target not found in file tree:', resolvedPath);
          }
        } catch (err) {
          console.error('Error resolving link:', err);
        }
      });
    }
  });
}
