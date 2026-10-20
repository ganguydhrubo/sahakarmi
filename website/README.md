# Sahkarmi website

One page: headline, one explainer video, one Download for Windows button. English and हिन्दी
(toggle top-right, or `?lang=hi`). Pure HTML/CSS/JS in `index.html`, no build step.

- **Add the explainer video:** save it as `website/assets/sahkarmi-explainer.mp4` (H.264 MP4,
  1920×1080, ideally under 50 MB) and push to `main`. Until then the play button shows
  "Video coming soon" over the app screenshot.
- **Download button:** always points at the newest `*-x64.exe` on GitHub Releases (looked up live),
  falling back to the Releases page.
- **Contact:** hi@goliv.online · WhatsApp +91 82408 01921 (footer).
- **Hosting:** `.github/workflows/pages.yml` publishes this folder to GitHub Pages on every push
  that touches `website/`. Site: https://sahkarmi.site/
  To use your own domain later, add it in Settings → Pages → Custom domain.
