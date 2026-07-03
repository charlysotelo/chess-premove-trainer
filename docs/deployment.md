# Deployment

This is a static site with no build step: `index.html` at the repo root
loads CSS/JS directly, so GitHub Pages can serve `master` as-is with no CI
pipeline. There is no `package.json`, no bundler, and nothing to compile —
pushing to `master` (or whatever branch GitHub Pages is configured to serve)
is the entire deploy.

Repo remote: `charlysotelo/chess-premove-trainer` on GitHub.

Third-party assets (jQuery, chess.js, chessboard.js) are pulled from public
CDNs at page-load time — there's no vendoring/pinning beyond the version
pinned in each `<script src>`/`<link href>` URL in `index.html`. Bumping a
library version means editing those URLs directly and re-testing the
premove flow by hand (see `docs/architecture.md`), since there's no test
suite to catch a breaking API change.
