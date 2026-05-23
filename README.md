# my Oncall Diaries

A personal blog and logbook for documenting engineering issues, cloud configurations, DevOps problems, and daily learnings. Built to stop searching chat histories and start building a searchable knowledge base.

## 🚀 Features

- **Markdown Native**: Write all your entries in standard Markdown (`.md`).
- **Code Highlighting**: Built-in syntax highlighting for HCL, YAML, Bash, Dockerfile, JavaScript, and more.
- **Fast Search**: Instant filtering and search across all files and topics.
- **Copy Code Blocks**: One-click copy for any snippet in your logs.
- **Fully Static**: No database required. Generates a fully static site that is easily hosted on GitHub Pages.
- **Dark/Light Mode**: Toggleable theme that remembers your preference (if implemented) or just provides an easy switch.

## 📁 Repository Structure

- `content/`: 📝 **Put your Markdown files here.** You can organize them into subfolders (e.g., `content/aws/`, `content/kubernetes/`). The app will automatically build a navigation tree based on this folder structure.
- `app/`: Contains the viewer application, build scripts, and the generated public site.
- `.github/workflows/`: Contains the CI/CD pipeline for GitHub Actions.

## 🛠️ How to Add Content

1. Create a new `.md` file inside the `content/` directory.
2. Group files into logical folders if desired.
3. Commit and push your changes to the `main` branch. GitHub Actions will automatically rebuild the site and deploy it!

## 💻 Local Development & Testing

To preview your site locally before pushing:

1. **Navigate to the app directory**:
   ```bash
   cd app
   ```

2. **Install dependencies** (only needed once):
   ```bash
   npm install
   ```

3. **Build the static site**:
   ```bash
   npm run build
   ```
   This will run the `build.js` script, which scans your `content/` directory, generates a `tree.json` index, and copies all markdown files into the `app/public/content/` folder.

4. **Serve the static files**:
   Since the app is now fully static (for GitHub Pages compatibility), you can serve the `app/public` folder using any static web server. For example, you can use `npx`:
   ```bash
   npx serve public
   ```
   Or using Python:
   ```bash
   cd public
   python3 -m http.server 3000
   ```
   Then open `http://localhost:3000` in your browser.

## 🌐 Deployment (GitHub Pages)

This repository is already configured with a continuous integration pipeline (`deploy.yml`). 

To make it live:
1. Go to your repository **Settings** on GitHub.
2. Navigate to **Pages** in the left sidebar.
3. Under **Build and deployment**, set the **Source** to **GitHub Actions**.
4. Push a change to the `main` branch (or run the Action manually).
5. Your site will be available at your GitHub Pages URL!
