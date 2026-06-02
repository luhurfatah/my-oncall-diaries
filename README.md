# 📓 my Oncall Diaries

[![License](https://img.shields.io/github/license/luhurfatah/my-oncall-diaries?style=flat-square&color=4169E1)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Static%20Hosting-lightgrey?style=flat-square)](https://pages.github.com/)

A static knowledge base and engineering notebook. **my Oncall Diaries** is designed for engineers who want a lightning-fast, searchable, and distraction-free platform to organize runbooks, cheat sheets, lab notes, and portfolios using pure Markdown.

🌐 **Live Demo**: [oncall-diaries.luhurfatah.com](https://oncall-diaries.luhurfatah.com/)

---

## ✨ Features

- **Lightning Fast & Static** — Zero database queries. Runs purely on pre-rendered static HTML, CSS, and JS.
- **Instant Global Search** — Search and filter across all folders, topics, and files in real-time.
- **Modern Aesthetics** — Clean layout, elegant typography, responsive grid, and responsive dark/light mode toggle.
- **Auto-Generated Navigation** — Sidebar and directories are dynamically generated based on your `content/` folder structure.
- **Syntax Highlighting** — Native styling for HCL (Terraform/Terragrunt), YAML, Bash, Python, Dockerfiles, and JSON.
- **One-Click Code Copy** — Interactive copy button on all code snippets.
- **Serverless Deployment** — Perfect for GitHub Pages, Cloudflare Pages, AWS S3, or Vercel.

---

## 📂 Directory Structure

The content is logically organized into dedicated modules:

| Directory | Purpose |
| :--- | :--- |
| `content/01-knowledge-base/` | In-depth technical guides (AWS, Kubernetes, SRE, CI/CD, IaC) |
| `content/02-interview-prep/` | Dynamic cheat sheets and core platform engineering Q&A |
| `content/03-labs/` | Step-by-step platform engineering lab tutorials |
| `content/99-cv/` | Professional curriculum vitae formatted in Markdown |

---

## 🛠️ Getting Started (Local Development)

Launch your personal knowledge base locally in under 5 minutes.

### Prerequisites
* **Git**
* **Node.js** v20+

### 1. Clone the Repository
```bash
git clone https://github.com/luhurfatah/my-oncall-diaries.git
cd my-oncall-diaries
```

### 2. Install Dependencies
```bash
cd app
npm install
```

### 3. Add Your Content
Add or modify `.md` files inside the `content/` directory. Subdirectories automatically map to navigation categories.
```
content/
├── 01-knowledge-base/
│   └── aws-vpc-peering.md
├── 02-interview-prep/
│   └── kubernetes-networking.md
└── 99-cv/
    └── resume.md
```

### 4. Build and Preview
Build the static files:
```bash
npm run build
```

Serve the generated static site locally:
```bash
# Option A: using npx serve
npx serve public

# Option B: using python3
cd public && python3 -m http.server 3000
```
Visit **http://localhost:3000** in your browser.

---

## 🌐 Automated Deployment (GitHub Pages)

This repository includes a pre-configured GitHub Actions pipeline (`.github/workflows/deploy.yml`) to automatically rebuild and host your site for free.

1. **Fork** this repository.
2. Go to your repository **Settings** → **Pages** (left sidebar).
3. Under **Build and deployment**, set the **Source** to **GitHub Actions**.
4. Push any changes to the `main` branch to trigger an automatic deployment.

Your site will automatically go live at:
```
https://<your-github-username>.github.io/myoncalldiaries/
```

---

## 📁 Repository Layout

```
myoncalldiaries/
├── .github/
│   └── workflows/
│       └── deploy.yml       # Automated GitHub Actions build & deploy pipeline
├── app/
│   ├── build.js             # Static site generator (scans content/, compiles directories)
│   ├── server.js            # Optional development server
│   ├── package.json         # Build tool dependencies
│   └── public/              # Target output folder containing the static HTML/CSS site
├── content/                 # Write your Markdown documents here
│   ├── 01-knowledge-base/
│   ├── 02-interview-prep/
│   ├── 03-labs/
│   └── 99-cv/
└── README.md
```

---

## 📄 License

Distributed under the MIT License. Feel free to fork, adapt, and build your own.
