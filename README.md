# UTTARKUNTH website — GitHub + Netlify

This is a static website package made from your supplied UTTARKUNTH HTML file. The homepage is `index.html`; the design and embedded image assets are kept in that file.

## Publish with GitHub and Netlify

1. Extract this ZIP file.
2. Create a new repository on GitHub, for example `uttarkunth-website`.
3. Upload `index.html`, `netlify.toml`, and this README to the repository root (not inside another nested folder). Commit the files.
4. Sign in to Netlify and choose **Add new site → Import an existing project**.
5. Connect GitHub, select `uttarkunth-website`, and authorize access if asked.
6. In deploy settings, set **Build command** to blank / none and **Publish directory** to `.`. The included `netlify.toml` already specifies the publish directory.
7. Click **Deploy site**. Netlify will provide a public `*.netlify.app` URL.
8. Future commits pushed to the connected GitHub repository will trigger a new deployment automatically.

## Important notes

- The site is static HTML and does not need `npm install` or a build command.
- Website images encoded directly in the HTML are retained, so there are no local image folders to upload.
- Review the email, WhatsApp, YouTube, Google Maps, reviews, and video links in `index.html` before publishing to ensure they are current and intended to be public.
- This package does not push to your GitHub account or create a Netlify site for you; you will need to sign in and complete those steps.
