'use strict';

/**
 * Haya Fixed Visual Identity & Portrait Manager
 * Maintains a consistent, original fictional portrait of Haya (20-year-old Pakistani woman from Haseerpur):
 * - Decent Pakistani outfit (emerald & ivory embroidered shalwar kameez with graceful dupatta)
 * - Clearly visible elegant traditional jhumka earrings
 * - Distinctive emerald-gold ring on her hand
 * - Specific, unique gold locket necklace around her neck
 * - Soft, friendly facial expression
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { DATA_DIR, ROOT_DIR } = require('./storagePaths');

const PORTRAIT_STORAGE_DIR = path.join(DATA_DIR, 'haya_portrait');
const PUBLIC_ASSETS_DIR = path.join(ROOT_DIR, 'public', 'assets');
const DEFAULT_PORTRAIT_FILE = path.join(PORTRAIT_STORAGE_DIR, 'haya_master_portrait.png');
const PUBLIC_PORTRAIT_FILE = path.join(PUBLIC_ASSETS_DIR, 'haya_master_portrait.png');

const ALLOWED_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

for (const dir of [PORTRAIT_STORAGE_DIR, PUBLIC_ASSETS_DIR]) {
    try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (_) {}
}

/**
 * Build the high-resolution SVG master portrait for Haya with all mandatory visual identity markers:
 * 1. 20-year-old fictional Pakistani woman with warm, friendly smile
 * 2. Decent Pakistani emerald & ivory embroidered outfit with draped dupatta
 * 3. Clearly visible elegant gold jhumka earrings
 * 4. Distinctive gold & emerald ring on her right hand
 * 5. Specific, unique heart-and-crescent gold locket necklace
 */
function buildMasterPortraitSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1125" viewBox="0 0 900 1125">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f2922"/>
      <stop offset="50%" stop-color="#13382e"/>
      <stop offset="100%" stop-color="#1e1b2e"/>
    </linearGradient>
    <radialGradient id="warmGlow" cx="50%" cy="32%" r="55%">
      <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.24"/>
      <stop offset="60%" stop-color="#10b981" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="skinTone" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#f5cba7"/>
      <stop offset="65%" stop-color="#eab68c"/>
      <stop offset="100%" stop-color="#d99e73"/>
    </linearGradient>
    <linearGradient id="hairGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1c1411"/>
      <stop offset="50%" stop-color="#291d18"/>
      <stop offset="100%" stop-color="#120c0a"/>
    </linearGradient>
    <linearGradient id="dressGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#047857"/>
      <stop offset="50%" stop-color="#065f46"/>
      <stop offset="100%" stop-color="#064e3b"/>
    </linearGradient>
    <linearGradient id="dupattaGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef3c7" stop-opacity="0.94"/>
      <stop offset="100%" stop-color="#fde68a" stop-opacity="0.88"/>
    </linearGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef08a"/>
      <stop offset="45%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
  </defs>

  <!-- Soft Studio Portrait Backdrop -->
  <rect width="900" height="1125" fill="url(#bgGrad)"/>
  <circle cx="450" cy="400" r="460" fill="url(#warmGlow)"/>

  <!-- Subtle Pakistani Arch Motif in Background -->
  <path d="M 180 1125 L 180 420 Q 180 160 450 90 Q 720 160 720 420 L 720 1125" fill="none" stroke="#fbbf24" stroke-opacity="0.16" stroke-width="2.5"/>
  <path d="M 205 1125 L 205 430 Q 205 185 450 118 Q 695 185 695 430 L 695 1125" fill="none" stroke="#fbbf24" stroke-opacity="0.08" stroke-width="1.5"/>

  <!-- Long Wavy Dark Hair (Back Layer) -->
  <path d="M 260 360 C 215 480, 210 680, 255 830 C 310 860, 590 860, 645 830 C 690 680, 685 480, 640 360 C 610 210, 290 210, 260 360 Z" fill="url(#hairGrad)"/>

  <!-- Decent Pakistani Outfit: Emerald Embroidered Kameez -->
  <path d="M 175 1125 C 190 830, 275 730, 355 705 L 545 705 C 625 730, 710 830, 725 1125 Z" fill="url(#dressGrad)" stroke="#d97706" stroke-width="3"/>

  <!-- Gold Zari Embroidery on Kameez Neckline -->
  <path d="M 355 710 Q 450 825 545 710" fill="none" stroke="url(#goldGrad)" stroke-width="8"/>
  <path d="M 340 725 Q 450 855 560 725" fill="none" stroke="url(#goldGrad)" stroke-width="2.5" stroke-dasharray="6,6"/>
  <line x1="450" y1="770" x2="450" y2="1080" stroke="url(#goldGrad)" stroke-width="4" stroke-dasharray="10,8"/>

  <!-- Graceful Ivory & Gold Dupatta Draped Over Shoulders -->
  <path d="M 165 1125 C 180 860, 235 745, 340 708 C 365 820, 340 960, 310 1125 Z" fill="url(#dupattaGrad)" stroke="url(#goldGrad)" stroke-width="4"/>
  <path d="M 735 1125 C 720 860, 665 745, 560 708 C 510 850, 420 940, 240 1125 L 735 1125 Z" fill="url(#dupattaGrad)" opacity="0.92" stroke="url(#goldGrad)" stroke-width="4"/>

  <!-- Neck & Collarbone -->
  <path d="M 392 560 L 392 715 Q 450 765 508 715 L 508 560 Z" fill="url(#skinTone)"/>

  <!-- SPECIFIC UNIQUE NECKLACE / LOCKET (Gold Chain + Emerald-Gold Crescent Pendant) -->
  <path d="M 380 650 Q 450 755 520 650" fill="none" stroke="url(#goldGrad)" stroke-width="5"/>
  <path d="M 386 660 Q 450 765 514 660" fill="none" stroke="#fef08a" stroke-width="2" stroke-dasharray="4,4"/>
  <!-- Unique Locket Pendant -->
  <g transform="translate(450, 718)">
    <circle cx="0" cy="0" r="22" fill="url(#goldGrad)" stroke="#fef08a" stroke-width="3"/>
    <circle cx="0" cy="0" r="13" fill="#047857" stroke="#fef08a" stroke-width="1.5"/>
    <polygon points="0,-8 3,-2 9,-2 4,2 6,8 0,4 -6,8 -4,2 -9,-2 -3,-2" fill="#fef08a"/>
    <circle cx="-14" cy="24" r="4" fill="url(#goldGrad)"/>
    <circle cx="0" cy="28" r="5" fill="url(#goldGrad)"/>
    <circle cx="14" cy="24" r="4" fill="url(#goldGrad)"/>
  </g>

  <!-- Ears -->
  <ellipse cx="295" cy="465" rx="18" ry="34" fill="url(#skinTone)"/>
  <ellipse cx="605" cy="465" rx="18" ry="34" fill="url(#skinTone)"/>

  <!-- CLEARLY VISIBLE ELEGANT JHUMKA EARRINGS (Left & Right) -->
  <!-- Left Jhumka Earring -->
  <g transform="translate(292, 492)">
    <circle cx="0" cy="0" r="10" fill="url(#goldGrad)" stroke="#fef08a" stroke-width="2"/>
    <circle cx="0" cy="0" r="5" fill="#047857"/>
    <line x1="0" y1="10" x2="0" y2="24" stroke="url(#goldGrad)" stroke-width="4"/>
    <path d="M -22 44 Q 0 16 22 44 Z" fill="url(#goldGrad)" stroke="#fef08a" stroke-width="2"/>
    <circle cx="-18" cy="52" r="4" fill="#fef08a"/>
    <circle cx="-9" cy="55" r="4.5" fill="#fef08a"/>
    <circle cx="0" cy="57" r="5" fill="#047857" stroke="#fef08a" stroke-width="1.5"/>
    <circle cx="9" cy="55" r="4.5" fill="#fef08a"/>
    <circle cx="18" cy="52" r="4" fill="#fef08a"/>
  </g>

  <!-- Right Jhumka Earring -->
  <g transform="translate(608, 492)">
    <circle cx="0" cy="0" r="10" fill="url(#goldGrad)" stroke="#fef08a" stroke-width="2"/>
    <circle cx="0" cy="0" r="5" fill="#047857"/>
    <line x1="0" y1="10" x2="0" y2="24" stroke="url(#goldGrad)" stroke-width="4"/>
    <path d="M -22 44 Q 0 16 22 44 Z" fill="url(#goldGrad)" stroke="#fef08a" stroke-width="2"/>
    <circle cx="-18" cy="52" r="4" fill="#fef08a"/>
    <circle cx="-9" cy="55" r="4.5" fill="#fef08a"/>
    <circle cx="0" cy="57" r="5" fill="#047857" stroke="#fef08a" stroke-width="1.5"/>
    <circle cx="9" cy="55" r="4.5" fill="#fef08a"/>
    <circle cx="18" cy="52" r="4" fill="#fef08a"/>
  </g>

  <!-- Face Contour -->
  <path d="M 302 390 C 302 275, 598 275, 598 390 C 598 515, 535 618, 450 628 C 365 618, 302 515, 302 390 Z" fill="url(#skinTone)"/>

  <!-- Soft Rosy Cheeks -->
  <ellipse cx="362" cy="488" rx="34" ry="20" fill="#e11d48" opacity="0.13"/>
  <ellipse cx="538" cy="488" rx="34" ry="20" fill="#e11d48" opacity="0.13"/>

  <!-- Hair Framing Face -->
  <path d="M 295 405 C 285 300, 365 245, 450 255 C 535 245, 615 300, 605 405 C 585 335, 520 295, 450 305 C 380 295, 315 335, 295 405 Z" fill="url(#hairGrad)"/>

  <!-- Expressive Eyebrows -->
  <path d="M 345 402 Q 385 384 420 400" fill="none" stroke="#291d18" stroke-width="6" stroke-linecap="round"/>
  <path d="M 480 400 Q 515 384 555 402" fill="none" stroke="#291d18" stroke-width="6" stroke-linecap="round"/>

  <!-- Warm Expressive Brown Eyes -->
  <g>
    <ellipse cx="384" cy="434" rx="26" ry="15" fill="#ffffff"/>
    <circle cx="384" cy="434" r="12" fill="#3e2723"/>
    <circle cx="384" cy="434" r="6" fill="#111111"/>
    <circle cx="389" cy="429" r="3.5" fill="#ffffff"/>
    <path d="M 354 432 Q 384 414 414 434" fill="none" stroke="#1c1411" stroke-width="4.5" stroke-linecap="round"/>
  </g>
  <g>
    <ellipse cx="516" cy="434" rx="26" ry="15" fill="#ffffff"/>
    <circle cx="516" cy="434" r="12" fill="#3e2723"/>
    <circle cx="516" cy="434" r="6" fill="#111111"/>
    <circle cx="521" cy="429" r="3.5" fill="#ffffff"/>
    <path d="M 486 434 Q 516 414 546 432" fill="none" stroke="#1c1411" stroke-width="4.5" stroke-linecap="round"/>
  </g>

  <!-- Delicate Nose & Small Gold Nose Stud -->
  <path d="M 450 435 L 444 494 Q 450 503 460 496" fill="none" stroke="#c58c63" stroke-width="3.5" stroke-linecap="round"/>
  <circle cx="463" cy="489" r="3.2" fill="url(#goldGrad)" stroke="#fef08a" stroke-width="1"/>

  <!-- Warm, Friendly, Polite Smile -->
  <path d="M 408 538 Q 450 568 492 538" fill="none" stroke="#b91c1c" stroke-width="5.5" stroke-linecap="round"/>
  <path d="M 416 541 Q 450 560 484 541" fill="none" stroke="#f43f5e" stroke-width="3" opacity="0.65" stroke-linecap="round"/>

  <!-- Graceful Right Hand Resting Near Dupatta with DISTINCTIVE RING -->
  <g transform="translate(360, 865)">
    <!-- Hand & Fingers -->
    <path d="M 0 110 C 10 55, 45 25, 95 20 C 135 18, 175 35, 185 65 C 190 95, 155 135, 95 145 L 15 155 Z" fill="url(#skinTone)" stroke="#d99e73" stroke-width="2"/>
    <!-- Finger Separation Lines -->
    <path d="M 110 38 L 168 46" stroke="#c58c63" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M 112 68 L 178 74" stroke="#c58c63" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M 108 98 L 168 102" stroke="#c58c63" stroke-width="2.5" stroke-linecap="round"/>
    <!-- Gold Bangle on Wrist -->
    <path d="M 8 102 Q 25 132 18 156" fill="none" stroke="url(#goldGrad)" stroke-width="9" stroke-linecap="round"/>
    <path d="M 22 98 Q 39 128 32 152" fill="none" stroke="#fef08a" stroke-width="4" stroke-linecap="round"/>

    <!-- DISTINCTIVE RING ON FINGER (Gold Band + Emerald Gem Setting) -->
    <g transform="translate(136, 59)">
      <rect x="-6" y="-12" width="12" height="24" rx="4" fill="url(#goldGrad)" stroke="#fef08a" stroke-width="1.5"/>
      <circle cx="0" cy="0" r="11" fill="url(#goldGrad)" stroke="#fef08a" stroke-width="2"/>
      <circle cx="0" cy="0" r="6.5" fill="#047857"/>
      <circle cx="-2" cy="-2" r="2" fill="#a7f3d0"/>
    </g>
  </g>

  <!-- Subtle Bottom Vignette & Identity Caption Frame -->
  <rect x="45" y="1015" width="810" height="72" rx="18" fill="#030712" fill-opacity="0.72" stroke="#f59e0b" stroke-opacity="0.4" stroke-width="1.5"/>
  <text x="450" y="1058" text-anchor="middle" fill="#fef3c7" font-family="sans-serif" font-size="24" font-weight="bold">Haya (حیا) • Haseerpur • AI Character Portrait</text>
</svg>`;
}

/**
 * Ensure the fixed master portrait exists on disk as a valid PNG image
 */
async function ensureMasterPortraitAsset() {
    if (fs.existsSync(DEFAULT_PORTRAIT_FILE) && fs.existsSync(PUBLIC_PORTRAIT_FILE)) {
        try {
            const stat = fs.statSync(DEFAULT_PORTRAIT_FILE);
            if (stat.size > 1024) {
                return {
                    exists: true,
                    filePath: DEFAULT_PORTRAIT_FILE,
                    publicUrl: '/assets/haya_master_portrait.png',
                    sizeBytes: stat.size,
                    mimeType: 'image/png'
                };
            }
        } catch (_) {}
    }

    const svgBuffer = Buffer.from(buildMasterPortraitSvg(), 'utf8');
    const pngBuffer = await sharp(svgBuffer)
        .png({ quality: 95, compressionLevel: 8 })
        .toBuffer();

    fs.writeFileSync(DEFAULT_PORTRAIT_FILE, pngBuffer);
    fs.writeFileSync(PUBLIC_PORTRAIT_FILE, pngBuffer);

    return {
        exists: true,
        filePath: DEFAULT_PORTRAIT_FILE,
        publicUrl: '/assets/haya_master_portrait.png',
        sizeBytes: pngBuffer.length,
        mimeType: 'image/png'
    };
}

/**
 * Retrieve the current approved Haya portrait buffer & metadata for WhatsApp sending
 */
async function getApprovedHayaPortrait(settings = {}) {
    await ensureMasterPortraitAsset();

    let targetFile = DEFAULT_PORTRAIT_FILE;
    let publicUrl = '/assets/haya_master_portrait.png';
    let mimeType = 'image/png';

    const customRelPath = settings?.masterPortraitPath;
    if (customRelPath && customRelPath !== '/assets/haya_master_portrait.png') {
        const candidatePublic = path.join(ROOT_DIR, 'public', customRelPath.replace(/^\/+/, ''));
        const candidateData = path.join(PORTRAIT_STORAGE_DIR, path.basename(customRelPath));
        if (fs.existsSync(candidateData)) {
            targetFile = candidateData;
            publicUrl = customRelPath;
        } else if (fs.existsSync(candidatePublic)) {
            targetFile = candidatePublic;
            publicUrl = customRelPath;
        }
    }

    if (!fs.existsSync(targetFile)) {
        return { available: false, error: 'Portrait asset file not found on disk' };
    }

    const buffer = fs.readFileSync(targetFile);
    if (!buffer || buffer.length < 256) {
        return { available: false, error: 'Portrait asset is empty or corrupted' };
    }

    const ext = path.extname(targetFile).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.webp') mimeType = 'image/webp';
    else mimeType = 'image/png';

    const maxBytes = Number(settings?.maxImageSizeMb || 5) * 1024 * 1024;
    if (buffer.length > maxBytes) {
        return { available: false, error: `Portrait file exceeds maximum allowed size (${settings?.maxImageSizeMb || 5} MB)` };
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);

    return {
        available: true,
        buffer,
        filePath: targetFile,
        publicUrl,
        mimeType,
        sizeBytes: buffer.length,
        assetId: settings?.masterPortraitAssetId || `haya_portrait_${sha256}`,
        sha256
    };
}

/**
 * Update the master portrait from an Admin upload (base64 data URL or raw base64)
 */
async function updateMasterPortraitFromBase64(dataUrlOrBase64, mimeHint = 'image/png', maxMb = 5) {
    if (!dataUrlOrBase64 || typeof dataUrlOrBase64 !== 'string') {
        throw new Error('Image data is required to update Haya master portrait');
    }

    let detectedMime = mimeHint || 'image/png';
    let base64Clean = dataUrlOrBase64.trim();
    const match = base64Clean.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/i);
    if (match) {
        detectedMime = match[1].toLowerCase();
        base64Clean = match[2];
    }

    if (!ALLOWED_MIMES.has(detectedMime)) {
        throw new Error(`Unsupported image format (${detectedMime}). Allowed formats: PNG, JPEG, WEBP.`);
    }

    const rawBuffer = Buffer.from(base64Clean, 'base64');
    const maxBytes = Math.max(1, Number(maxMb || 5)) * 1024 * 1024;
    if (rawBuffer.length > maxBytes) {
        throw new Error(`Uploaded image exceeds maximum size limit of ${maxMb} MB.`);
    }

    // Normalize & validate image via sharp
    const normalizedPng = await sharp(rawBuffer)
        .resize({ width: 900, height: 1125, fit: 'cover' })
        .png({ quality: 92 })
        .toBuffer();

    const hash = crypto.createHash('sha256').update(normalizedPng).digest('hex').slice(0, 12);
    const fileName = `haya_custom_portrait_${hash}.png`;
    const dataPath = path.join(PORTRAIT_STORAGE_DIR, fileName);
    const publicPath = path.join(PUBLIC_ASSETS_DIR, fileName);

    fs.writeFileSync(dataPath, normalizedPng);
    fs.writeFileSync(publicPath, normalizedPng);

    return {
        assetId: `haya_custom_${hash}`,
        publicUrl: `/assets/${fileName}`,
        sizeBytes: normalizedPng.length,
        mimeType: 'image/png'
    };
}

/**
 * Reset back to the default Haya master portrait
 */
async function resetToDefaultMasterPortrait() {
    if (fs.existsSync(DEFAULT_PORTRAIT_FILE)) {
        try { fs.unlinkSync(DEFAULT_PORTRAIT_FILE); } catch (_) {}
    }
    const info = await ensureMasterPortraitAsset();
    return {
        assetId: 'haya_master_v1',
        publicUrl: info.publicUrl,
        sizeBytes: info.sizeBytes,
        mimeType: info.mimeType
    };
}

// Initialize default portrait asset on load
ensureMasterPortraitAsset().catch(err => {
    console.warn('[hayaPortrait] Initial portrait generation warning:', err.message);
});

module.exports = {
    ensureMasterPortraitAsset,
    getApprovedHayaPortrait,
    updateMasterPortraitFromBase64,
    resetToDefaultMasterPortrait
};
