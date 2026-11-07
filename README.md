# Hue Harmony: a color grading helper

A browser app that maps a photo's hues onto a color wheel, fits a color harmony to them, and shows where to push each hue. Everything runs locally in the browser, so photos are never uploaded.

## What it does

1. **Hue clustering.** Each pixel's hue (HSV) goes into a 1° histogram. Near-neutral pixels (low saturation or brightness) are skipped, since their hue is unreliable; both cutoffs are adjustable. Hues are clustered with a weighted k-means that works on the circle, so 359° and 1° count as neighbours.
   - **Auto:** picks the *fewest* clusters (1 to 8) whose RMS hue spread is within the tolerance (default ±15°).
   - **Fixed:** choose 1 to 8 clusters yourself.
   - **Sampled:** click the photo to sample the colors you want to highlight. Those hues become the cluster centers, and the harmony is fitted to them only.
2. **Harmonies:** complementary, analogous, triadic, split complementary and tetradic (rectangle). Each one is auto-rotated to minimise the weighted squared distance from your hues to its nearest target hue. The list shows how far off each harmony is and marks the best fit. Drag the wheel to rotate the harmony by hand.
3. **Where to push:** each cluster is matched to its nearest harmony hue, and the app lists the signed shift (e.g. `+11°`).
4. **Live preview and export:** hue shifts are blended smoothly between clusters and applied to the photo (saturation and brightness are unchanged). Set the push strength, limit which hues are affected, hold the button to compare with the original, and download a full-resolution JPEG.

## Develop

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # unit tests for the color/cluster/harmony math
npm run build   # production build in dist/
```

## Deploy to Vercel (free)

1. Go to <https://vercel.com/new> and sign in with GitHub.
2. Import the `color-grading-helper` repository. Vercel detects Vite automatically (build `npm run build`, output `dist`).
3. Click **Deploy**. Each push to the production branch redeploys, and other branches get preview URLs.

Netlify, Cloudflare Pages and GitHub Pages also work, since the output is a plain static site.
