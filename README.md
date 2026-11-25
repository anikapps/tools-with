# Tools with Anik

**Tools with Anik** is a fast, local-first, Light-Mode-default web workspace unifying **22 PDF Workspace tools**, a **16-engine PDF Batch Studio**, a full **Converter Studio** (DOC, DOCX, RTF, ODT, PDF, XLS, XLSX, ODS, CSV, JSON, YAML, XML, HTML, Markdown with full Unicode/Bangla & embedded-image PDF rendering), **beautified document & card generators**, **200+ standalone daily utilities**, and **6 offline mini-games** into one modern React + TypeScript + Vite application. All processing happens directly in your browser with zero file uploads.

## Included Modules (251 Tools across 13 Categories)

- **1. PDF Workspace (22 Flagship Tools)**: Compress (Auto, Smart image shrink, Target-KB binary search, Lossless), Visual Merge & Page Organizer, Split & Extract (ZIP), 8-Mode Convert, Clean-up & Blank-Page Scanner, Interactive Crop, Permanent Redact, Signature Pad & Stamp, Headers/Footers/Bates/Watermarks, Page Layout (Resize/N-Up/Booklet/Reverse), Metadata Inspector, Extract Text & Embedded Images, Full-Text Highlight Search, Pixel-Diff PDF Compare, Grayscale, Flatten, Repair, and Beautified Markdown to PDF.
- **2. Converter Studio (14 Flagship Tools)**: Universal Any-to-Any File Converter with inline PDF.js page preview, **DOC / DOCX / RTF / ODT → PDF** (with HiDPI Unicode/Bangla & embedded image rendering), **PDF → DOCX**, **XLS / XLSX / ODS → CSV** (single sheet or all-sheets ZIP), **CSV → PDF** beautified table reports, **XLS / XLSX → PDF** (active sheet or all-sheets combined PDF with wide-column pagination), **CSV → XLSX**, **XLSX → JSON / HTML / Markdown**, **DOC / DOCX → HTML / TXT**, **Markdown / HTML → DOCX & PDF**, **PDF → XLSX**, **JSON → XLSX & PDF**, and a 6-format **JSON ⇄ CSV ⇄ TSV ⇄ YAML ⇄ XML ⇄ Markdown** Data Matrix.
- **3. Pro Batch Studio (36 Engines)**:
  - **16 PDF Batch Engines** with 3 independent queues (Queue A/B/C), folder upload, pause/cancel/retry, and ZIP export.
  - **20 Image & File Batch Engines** for bulk format conversion, compression, resizing, cropping, watermarking, EXIF stripping, SHA-256/CRC-32 audits, and ZIP archiving.
- **4. Image Studio (29 Tools)**: Format Converter, Target-KB Compressor, Resizer/Cropper/Aspect Ratio, Darkroom Filters & Auto-Enhance, Mac/Polaroid/Rounded Frames, Watermark & Meme toggles, Annotation Brush & Region Blur, Chroma-Key Background Remover, Color Palette Extractor, Favicon & PWA Icon Packs, IG 3×3 Grid Cutter, Collage & Screenshot Stitcher, Animated GIF89a Maker, and SVG Vectorizer.
- **5. Text Studio (23 Tools)**, **File & Data (19 Tools incl. CSV Validator & Bar Chart, JSON/XML Formatter, SHA-256 ZIP Packager)**, **Calculators (38 Tools incl. Calculus Graphing, % Change, Final Exam Grade Needed, Ratio Solver, TDEE/Macros)**, **Developer Tools (15 Tools incl. HTML/CSS/JS/SQL/XML Formatters & ISO→Epoch)**, **Productivity (14 Tools incl. HIIT Interval Timer, Goal Milestones, EN/বাংলা Typing)**, **Travel Tools (12 Tools incl. Budget Planner, Itinerary, Offline Astronomical Sunrise/Sunset)**, **Everyday Utilities (27 Tools incl. QR/Barcode SVG+PNG, Diceware & SHA-1/256/512, Hijri Date Picker, Lucky Draw & Random Teams, Morse WAV, Printable Calendar & Ruled/Grid/Dot/Music Paper)**, and **Business & Print (11 Beautified Generators)**.
- **Fun & Brain Games (6 Offline Mini-Games)**: 2048 Tile Puzzle, Reflex Speed Arena, Memory Card Match, 45s Speed Math Blitz, Classic Snake Arcade, and Word Scramble Challenge.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

## Deploy on GitHub Pages (1-Click Setup)

This repository includes `.github/workflows/deploy.yml` and relative asset paths (`base: './'`) so it deploys cleanly to GitHub Pages out of the box:

1. Upload or push all files from this archive to a GitHub repository (`main` branch).
2. In your GitHub repo, open **Settings → Pages**.
3. Under **Build and deployment → Source**, select **GitHub Actions**.
4. Push any commit (or run the workflow manually under **Actions**) — your live site will build, test, and publish automatically.

You can also deploy directly to **Vercel**, **Netlify**, or **Cloudflare Pages** using:
- **Build command**: `npm run build`
- **Output directory**: `dist`

## Scripts

- `npm run dev` — Start Vite development server on port 3000
- `npm run build` — Build production bundle into `dist/`
- `npm run preview` — Preview the production build locally
- `npm run lint` — TypeScript strict check (`tsc --noEmit`)
- `npm test` — Run unit tests (`src/utils/core.test.ts`)

## License

MIT — see [LICENSE](./LICENSE).
