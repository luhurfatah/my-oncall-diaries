# 📓 my Oncall Diaries

> A personal knowledge base and engineering blog — built for engineers who are tired of re-learning the same lessons twice.

Stop digging through old Slack threads and half-finished Notion pages. **my Oncall Diaries** is a lightweight, fully static site that turns your Markdown notes into a searchable, navigable knowledge base — deployable to GitHub Pages in minutes.

🌐 **Live Demo**: [View the site on GitHub Pages](https://your-username.github.io/myoncalldiaries)

---

## ✨ What's Inside

The knowledge base is organized into four sections:

| Section | Description |
|---|---|
| `01-knowledge-base/` | Deep-dive technical guides — AWS, Kubernetes, SRE, CI/CD, IaaC |
| `02-interview-prep/` | Cheat sheets and interview Q&A for cloud and platform engineering roles |
| `03-labs/` | Hands-on platform engineering labs (Backstage, Crossplane, Argo CD) |
| `99-cv/` | Professional CV in Markdown format |

---

## 🚀 Features

- **Markdown Native** — Write everything in standard `.md` files. No CMS, no database.
- **Instant Search** — Filter and search across all topics and files in real time.
- **Syntax Highlighting** — Built-in support for HCL, YAML, Bash, Dockerfile, Python, and more.
- **One-Click Copy** — Copy any code snippet directly from the rendered page.
- **Auto-Navigation** — The sidebar is generated automatically from your folder structure.
- **Fully Static** — No server needed. Runs on GitHub Pages out of the box.
- **Dark / Light Mode** — Theme toggle included.

---

## 🛠️ Fork & Run Your Own Copy

Want to use this as your own knowledge base? Here's how to get started in under 5 minutes.

### Prerequisites

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) v20+

### Step 1 — Fork this Repository

Click the **Fork** button at the top-right of this page on GitHub. This creates your own copy under your account.

### Step 2 — Clone Your Fork

```bash
git clone https://github.com/<your-username>/myoncalldiaries.git
cd myoncalldiaries
```

### Step 3 — Install Dependencies

```bash
cd app
npm install
```

### Step 4 — Add Your Own Content

Drop your Markdown files into the `content/` folder. Organize them into subfolders — the folder names become your navigation sections automatically.

```
content/
├── aws/
│   └── vpc-troubleshooting.md
├── kubernetes/
│   └── pod-scheduling.md
└── my-runbooks/
    └── on-call-checklist.md
```

### Step 5 — Preview Locally

```bash
# From the app/ directory
npm run build
```

Then serve the static output with any static server:

```bash
# Option A — using npx serve
npx serve public

# Option B — using Python (no install needed)
cd public && python3 -m http.server 3000
```

Open **http://localhost:3000** in your browser.

---

## 🌐 Deploy to GitHub Pages (Free Hosting)

This repo ships with a ready-to-use GitHub Actions pipeline. Every push to `main` automatically rebuilds and redeploys your site.

### One-time Setup

1. Go to your forked repo on GitHub.
2. Click **Settings** → **Pages** (left sidebar).
3. Under **Build and deployment**, set the **Source** to **GitHub Actions**.
4. Push any change to the `main` branch (or trigger the workflow manually from the **Actions** tab).

Your site will be live at:
```
https://<your-username>.github.io/myoncalldiaries/
```

That's it. No servers, no cloud bills.

---

## 📁 Repository Structure

```
myoncalldiaries/
├── .github/
│   └── workflows/
│       └── deploy.yml       # GitHub Actions CI/CD pipeline
├── app/
│   ├── build.js             # Scans content/, generates tree.json, copies assets
│   ├── server.js            # Optional local dev server
│   ├── package.json
│   └── public/              # Generated static site output (served by GitHub Pages)
├── content/                 # ✏️  YOUR MARKDOWN NOTES GO HERE
│   ├── 01-knowledge-base/
│   ├── 02-interview-prep/
│   ├── 03-labs/
│   └── 99-cv/
└── README.md
```

---

## 🤝 Contributing

This is a personal knowledge base, but PRs that improve the app itself (search, rendering, UI) are welcome. Open an issue first to discuss what you'd like to change.

---

## 📄 License

MIT — free to fork, adapt, and make your own.
