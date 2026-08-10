/* ============================================================
   NIGHT MATCH — Sprint Analyzer
   In-browser pose tracking (MediaPipe) → mechanics metrics →
   ranked fixes from the coach. Video never leaves the device.
   ============================================================ */

/* ---------------- sprint types ---------------- */
const SPRINT_TYPES = {
  acceleration: {
    id: 'acceleration',
    name: 'Acceleration',
    range: 'First 10–15m',
    blurb: 'Explosive first steps — the phase that wins duels, breakaways and recovery runs.',
    focus: ['Forward lean through the drive phase', 'Aggressive first-step push', 'Gradual rise to upright', 'Powerful arm drive'],
    ideal: { leanStart: [35, 50], leanEnd: [10, 25], cadence: [3.6, 4.6], kneeDrive: [60, 85] },
    film: {
      distance: 'Stand the camera about 5–6 m (16–20 ft) to the side of your run.',
      steps: [
        'Mark a start line and a finish cone ~15 m apart.',
        'Place the phone side-on, level with your hip, halfway along the run.',
        'Frame it so the whole 15 m is visible and your entire body stays in shot.',
        'Start recording, wait 2 seconds, then sprint from a standstill through the finish.',
        'Stop recording once you cross. Keep the clip under 10 seconds.',
      ],
    },
  },
  topspeed: {
    id: 'topspeed',
    name: 'Top speed',
    range: '20–30m flying',
    blurb: 'Upright sprint mechanics at full flight — how you hold and turn over top-end speed.',
    focus: ['Tall, stable posture', 'High knee drive', 'Fast turnover (cadence)', 'Symmetrical arm swing'],
    ideal: { lean: [2, 12], cadence: [4.2, 5.2], kneeDrive: [70, 95], armSym: [88, 100] },
    film: {
      distance: 'Stand the camera about 6–8 m (20–26 ft) to the side of the running lane.',
      steps: [
        'Give yourself a 20 m run-up so you are already at full speed in frame.',
        'Place the phone side-on, hip height, aimed at the middle of the flying zone.',
        'Frame roughly 10 m of lane — you should be fully in shot the whole way past.',
        'Start recording, run through the zone at full speed without slowing.',
        'Stop recording. Keep the clip under 10 seconds.',
      ],
    },
  },
  forty: {
    id: 'forty',
    name: '40-yard dash',
    range: 'Full 36m test',
    blurb: 'The full test — acceleration, transition and top speed analysed as separate phases.',
    focus: ['Drive-phase lean', 'Smooth transition to upright', 'Top-end turnover', 'Consistency across phases'],
    ideal: { leanStart: [35, 50], leanEnd: [5, 15], cadence: [4.0, 5.0], kneeDrive: [65, 90] },
    film: {
      distance: 'Stand the camera 10–12 m (33–40 ft) back so the whole run stays in frame.',
      steps: [
        'Mark a 40-yard (36 m) lane with a cone at each end.',
        'Place the phone side-on, hip height, level with the 20-yard mark.',
        'Back up far enough that you stay fully in frame start to finish.',
        'Start recording, wait 2 seconds, then run the full 40 from a standstill.',
        'Stop recording after the finish. Keep the clip under 12 seconds.',
      ],
    },
  },
};

const CAPTURE_SETUPS = {
  tripod: {
    id: 'tripod', name: 'Tripod / propped phone',
    tips: [
      'Prop the phone against a bag or bottle if you have no tripod — just keep it steady and level.',
      'Landscape orientation. Lens roughly at hip height.',
      'Do not move the phone once recording starts — a still camera lets us measure your speed.',
      'Film in the brightest light you have; avoid shooting into the sun.',
    ],
  },
  handheld: {
    id: 'handheld', name: 'Someone filming me',
    tips: [
      'Ask them to stand side-on and hold the phone steady at hip height, landscape.',
      'Best case they stay still and let you run through the frame.',
      'If they must pan to follow you, keep it slow and smooth — we will still read your mechanics, but speed and stride length cannot be measured from a panning camera.',
      'Tell them to keep your whole body in frame — head to feet, never cropped.',
    ],
  },
};

/* ---------------- tunables ---------------- */
const MAX_ANALYZE_SECONDS = 12;
const TARGET_FPS = 30;
const MAX_FRAMES = 360;
const PROC_WIDTH = 640;          // downscale for speed

/* MediaPipe landmark indices */
const L = {
  nose: 0,
  lShoulder: 11, rShoulder: 12,
  lElbow: 13, rElbow: 14,
  lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24,
  lKnee: 25, rKnee: 26,
  lAnkle: 27, rAnkle: 28,
  lHeel: 29, rHeel: 30,
  lToe: 31, rToe: 32,
};
const KEY_POINTS = [L.lShoulder, L.rShoulder, L.lHip, L.rHip, L.lKnee, L.rKnee, L.lAnkle, L.rAnkle];

/* ---------------- pose model ---------------- */
const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let _landmarker = null;
async function getLandmarker(onStatus) {
  if (_landmarker) return _landmarker;
  onStatus?.('Loading the motion model (first run only)…', 0.04, 0);
  let vision;
  try {
    vision = await import(/* @vite-ignore */ `${MP_BASE}/vision_bundle.mjs`);
  } catch {
    throw new Error('Could not load the motion model. Check your internet connection and try again.');
  }
  const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
  try {
    _landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  } catch {
    // some devices have no usable GPU delegate
    _landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      runningMode: 'VIDEO', numPoses: 1,
    });
  }
  return _landmarker;
}

/* ---------------- video → pose track ---------------- */
/* MediaPipe VIDEO mode demands strictly increasing timestamps even across
   separate passes over the same clip, so we keep one global counter. */
let _mpTs = 0;

async function extractPose(file, onProgress, opts = {}) {
  const landmarker = await getLandmarker(onProgress);
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url; video.muted = true; video.playsInline = true; video.preload = 'auto';

  try {
    await new Promise((res, rej) => {
      video.onloadedmetadata = () => res();
      video.onerror = () => rej(new Error('That file could not be read as a video. Try an MP4 or MOV.'));
      setTimeout(() => rej(new Error('Timed out reading the video.')), 20000);
    });

    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) throw new Error('That video has no readable picture track.');

    const total = video.duration || 0;
    if (!total || !isFinite(total)) throw new Error('That video has no readable duration.');

    // optional analysis window (used by the shooting refine pass)
    const start = Math.max(0, opts.startTime ?? 0);
    const end = Math.min(total, opts.endTime ?? MAX_ANALYZE_SECONDS, start + MAX_ANALYZE_SECONDS);
    const span = end - start;
    if (span <= 0.1) throw new Error('That video has no readable duration.');

    const scale = Math.min(1, PROC_WIDTH / vw);
    const cw = Math.round(vw * scale), ch = Math.round(vh * scale);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const fps = opts.fps ?? TARGET_FPS;
    const nFrames = Math.min(MAX_FRAMES, Math.max(2, Math.round(span * fps)));
    const dt = span / nFrames;
    const tsStep = Math.max(1, Math.round(dt * 1000));

    const frames = [];
    for (let i = 0; i < nFrames; i++) {
      const t = start + i * dt;                      // absolute clip time
      await seekTo(video, t);
      ctx.drawImage(video, 0, 0, cw, ch);
      let out = null;
      _mpTs += tsStep;
      try { out = landmarker.detectForVideo(canvas, _mpTs); } catch { /* skip frame */ }
      const lm = out?.landmarks?.[0] || null;
      frames.push({ t, lm });
      if (i % 3 === 0) onProgress?.(`Tracking your movement… ${Math.round((i / nFrames) * 100)}%`, 0.08 + (i / nFrames) * 0.72, 1);
    }
    onProgress?.('Measuring your mechanics…', 0.84, 2);
    return { frames, width: cw, height: ch, duration: span, startTime: start, srcWidth: vw, srcHeight: vh, fps: nFrames / span };
  } finally {
    URL.revokeObjectURL(url);
    video.src = '';
  }
}

function seekTo(video, t) {
  return new Promise((res, rej) => {
    let done = false;
    const ok = () => { if (!done) { done = true; video.removeEventListener('seeked', ok); res(); } };
    video.addEventListener('seeked', ok);
    try { video.currentTime = t; } catch { rej(new Error('Could not scan through the video.')); }
    setTimeout(ok, 400); // don't hang on a stubborn frame
  });
}

/* ---------------- geometry helpers ---------------- */
const px = (p, meta) => ({ x: p.x * meta.width, y: p.y * meta.height });
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const vis = (lm, i) => (lm?.[i]?.visibility ?? 0);

// angle of vector a→b measured from straight-up, in degrees (0 = up, 90 = horizontal)
function angleFromVertical(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;      // screen coords: +y is down
  return Math.abs(Math.atan2(dx, -dy) * 180 / Math.PI);
}
// signed: positive when b is in +dir horizontally from a
function signedLean(a, b, dir) {
  const dx = (b.x - a.x) * dir, dy = b.y - a.y;
  return Math.atan2(dx, -dy) * 180 / Math.PI;
}
function angleFromDown(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return Math.abs(Math.atan2(dx, dy) * 180 / Math.PI);
}

const median = arr => {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : NaN;
};
const mean = arr => { const a = arr.filter(Number.isFinite); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN; };
const pct = (arr, p) => {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.round((p / 100) * (a.length - 1))))] : NaN;
};
function smooth(series, win = 5) {
  const out = [];
  for (let i = 0; i < series.length; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - (win >> 1)); j <= Math.min(series.length - 1, i + (win >> 1)); j++) {
      if (Number.isFinite(series[j])) { s += series[j]; n++; }
    }
    out.push(n ? s / n : NaN);
  }
  return out;
}
// local maxima with minimum time separation and prominence
function findPeaks(vals, times, minSep, minProm) {
  const peaks = [];
  for (let i = 1; i < vals.length - 1; i++) {
    if (!Number.isFinite(vals[i])) continue;
    if (vals[i] >= vals[i - 1] && vals[i] > vals[i + 1]) {
      const lo = Math.min(...vals.slice(Math.max(0, i - 8), i + 1).filter(Number.isFinite));
      const hi = Math.min(...vals.slice(i, Math.min(vals.length, i + 9)).filter(Number.isFinite));
      const prom = vals[i] - Math.max(lo, hi);
      if (prom >= minProm) peaks.push({ i, t: times[i], v: vals[i], prom });
    }
  }
  peaks.sort((a, b) => a.t - b.t);
  const kept = [];
  for (const p of peaks) {
    const last = kept[kept.length - 1];
    if (!last || p.t - last.t >= minSep) kept.push(p);
    else if (p.prom > last.prom) kept[kept.length - 1] = p;
  }
  return kept;
}

/* parse "5'8\"" / "5 ft 8" / "173cm" / "1.73m" → metres */
function parseHeightMeters(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  let m = s.match(/(\d+(?:\.\d+)?)\s*(?:cm)/);
  if (m) return parseFloat(m[1]) / 100;
  m = s.match(/^(\d(?:\.\d+)?)\s*m$/);
  if (m) return parseFloat(m[1]);
  m = s.match(/(\d+)\s*(?:'|ft|feet)\s*(\d+(?:\.\d+)?)?/);
  if (m) return (parseInt(m[1]) * 12 + (parseFloat(m[2]) || 0)) * 0.0254;
  m = s.match(/^(\d{2,3})$/);
  if (m) { const n = parseInt(m[1]); if (n > 120 && n < 230) return n / 100; }
  return null;
}

/* ====================================================================
   v2 MATH — Savitzky-Golay smoothing + dot-product joint angles
   ==================================================================== */

// interior angle at b between a and c, via the dot product (degrees)
function jointAngle(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
  const d = (v1.x * v2.x + v1.y * v2.y) / ((Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)) || 1);
  return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
}

// Savitzky-Golay: local least-squares polynomial fit, value at window centre.
// Smooths tracking jitter far better than a moving average without lagging peaks.
function savgol(series, window = 7, poly = 3) {
  const n = series.length;
  if (n < 3) return series.slice();
  if (window % 2 === 0) window += 1;
  window = Math.min(window, n % 2 ? n : n - 1);
  const half = window >> 1;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const xw = [], ys = [];
    for (let k = -half; k <= half; k++) {
      let j = i + k; if (j < 0) j = 0; if (j >= n) j = n - 1;
      if (Number.isFinite(series[j])) { xw.push(k); ys.push(series[j]); }
    }
    out[i] = ys.length > poly ? polyfitCentre(xw, ys, poly) : (Number.isFinite(series[i]) ? series[i] : NaN);
  }
  return out;
}
function polyfitCentre(xw, ys, poly) {
  const m = poly + 1;
  const ATA = Array.from({ length: m }, () => new Array(m).fill(0));
  const ATy = new Array(m).fill(0);
  for (let p = 0; p < xw.length; p++) {
    const pw = [1]; for (let d = 1; d < 2 * m - 1; d++) pw.push(pw[d - 1] * xw[p]);
    for (let r = 0; r < m; r++) { for (let c = 0; c < m; c++) ATA[r][c] += pw[r + c]; ATy[r] += pw[r] * ys[p]; }
  }
  const sol = solveLinear(ATA, ATy);
  return sol ? sol[0] : ys[(ys.length - 1) >> 1];   // a0 = fitted value at x=0
}
function solveLinear(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-9) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) { if (r === col) continue; const f = M[r][col]; for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]; }
  }
  return M.map(row => row[n]);
}

/* ---------------- camera orientation ---------------- */
// shoulder separation ÷ torso length: small = side-on, large = facing camera.
function orientationRatio(track) {
  const FR = track.frames.filter(f => f.lm);
  const r = FR.map(f => {
    const shL = px(f.lm[L.lShoulder], track), shR = px(f.lm[L.rShoulder], track);
    const hp = mid(px(f.lm[L.lHip], track), px(f.lm[L.rHip], track));
    const torso = dist(mid(shL, shR), hp);
    return torso ? Math.abs(shL.x - shR.x) / torso : NaN;
  });
  return median(r);
}
function detectView(track) {
  const r = orientationRatio(track);
  if (!Number.isFinite(r)) return { view: 'side', ratio: r };
  return { view: r < 0.45 ? 'side' : r > 0.62 ? 'front' : 'oblique', ratio: +r.toFixed(2) };
}

/* ---------------- capture confidence (warn, don't block) ---------------- */
function captureConfidence(track, expectedView) {
  const FR = track.frames.filter(f => f.lm);
  const coverage = FR.length / track.frames.length;
  const det = detectView(track);
  const hipX = FR.map(f => mid(px(f.lm[L.lHip], track), px(f.lm[L.rHip], track)).x);
  const travelFrac = FR.length ? Math.abs(hipX[hipX.length - 1] - hipX[0]) / track.width : 0;
  const contactsGuess = FR.length >= 4;
  const panned = expectedView === 'side' && travelFrac < 0.22 && contactsGuess;
  const fpsLow = track.fps < 45;

  const warnings = [];
  let score = 1;
  const orientOff = expectedView === 'side'
    ? det.view !== 'side'
    : det.view !== 'front';
  if (orientOff) {
    score -= 0.35;
    warnings.push(expectedView === 'side'
      ? 'Camera looks angled, not square to the lane — perpendicular side-on gives the truest angles. Numbers here may read wider or narrower than reality.'
      : 'Camera does not look square-on from front/behind — face the lens straight down the lane for accurate valgus and sway.');
  }
  if (panned) { score -= 0.25; warnings.push('The camera appears to move with you. A still tripod is needed for speed and stride length — those are hidden here.'); }
  if (fpsLow) { score -= 0.2; warnings.push('This looks like standard-frame-rate video. Film in 60fps+ (slo-mo) so fast foot-strikes aren’t blurred between frames.'); }
  if (coverage < 0.8) { score -= 0.15; warnings.push('You weren’t tracked in the whole clip — better light and a clean background improve every reading.'); }

  return { score: Math.max(0, +score.toFixed(2)), warnings, detectedView: det.view, orientationRatio: det.ratio, panned, fpsLow, coverage: +coverage.toFixed(2) };
}

/* ---------------- quality gate ---------------- */
function gradeCapture(track) {
  const { frames, width, height } = track;
  const issues = [];
  const withPose = frames.filter(f => f.lm);
  const coverage = withPose.length / frames.length;

  if (track.duration < 1.2) {
    issues.push({ title: 'Clip too short', fix: 'Record at least 2–3 seconds of running so there are enough strides to read.' });
  }
  if (coverage < 0.6) {
    issues.push({ title: 'You were not detected in enough of the clip', fix: 'Film in brighter light, get closer, and make sure only you are in frame.' });
  }

  // key-joint visibility
  const visScores = withPose.map(f => mean(KEY_POINTS.map(i => vis(f.lm, i))));
  const medVis = median(visScores);
  if (withPose.length && medVis < 0.55) {
    issues.push({ title: 'Your legs and hips were not tracked cleanly', fix: 'Film side-on (not from the front or behind), and wear clothing that contrasts with the background.' });
  }

  // subject size in frame
  const sizes = withPose.map(f => {
    const sh = mid(px(f.lm[L.lShoulder], track), px(f.lm[L.rShoulder], track));
    const an = mid(px(f.lm[L.lAnkle], track), px(f.lm[L.rAnkle], track));
    return Math.abs(an.y - sh.y) / height;
  });
  const medSize = median(sizes);
  if (withPose.length && medSize < 0.22) {
    issues.push({ title: 'You are too small in the frame', fix: 'Move the camera closer (about 5–8 m away) or zoom in so your body fills more of the height.' });
  }

  // cropping — body leaving the frame
  let cropped = 0;
  for (const f of withPose) {
    const ys = [L.nose, L.lAnkle, L.rAnkle].map(i => f.lm[i]?.y ?? 0.5);
    const xs = [L.lShoulder, L.rShoulder, L.lAnkle, L.rAnkle].map(i => f.lm[i]?.x ?? 0.5);
    if (Math.min(...ys) < 0.02 || Math.max(...ys) > 0.98 || Math.min(...xs) < 0.01 || Math.max(...xs) > 0.99) cropped++;
  }
  if (withPose.length && cropped / withPose.length > 0.35) {
    issues.push({ title: 'Your body left the frame', fix: 'Back the camera up a few metres and re-aim so your head and feet stay in shot the whole run.' });
  }

  return { ok: issues.length === 0, issues, coverage, medVis, medSize };
}

/* ---------------- metrics (side view) ---------------- */
function computeMetrics(track, type, profile) {
  const frames = track.frames.filter(f => f.lm);
  const times = frames.map(f => f.t);
  const P = i => frames.map(f => px(f.lm[i], track));
  const conf = captureConfidence(track, 'side');

  const hipL = P(L.lHip), hipR = P(L.rHip);
  const shL = P(L.lShoulder), shR = P(L.rShoulder);
  const ankL = P(L.lAnkle), ankR = P(L.rAnkle);
  const kneeL = P(L.lKnee), kneeR = P(L.rKnee);
  const elbL = P(L.lElbow), elbR = P(L.rElbow);

  const hipC = frames.map((_, i) => mid(hipL[i], hipR[i]));
  const shC = frames.map((_, i) => mid(shL[i], shR[i]));

  /* --- scale: torso length ≈ 0.288 × standing height --- */
  const torsoPx = median(frames.map((_, i) => dist(shC[i], hipC[i])));
  const realH = parseHeightMeters(profile?.height);
  const heightPx = torsoPx / 0.288;
  const mPerPx = realH && heightPx ? realH / heightPx : null;

  /* --- direction of travel & camera motion --- */
  const hipX = hipC.map(p => p.x);
  const travel = hipX[hipX.length - 1] - hipX[0];
  const dir = travel >= 0 ? 1 : -1;
  const travelFrac = Math.abs(travel) / track.width;

  /* --- foot contacts → cadence (Savitzky-Golay smoothed ankle height) --- */
  const ankLy = savgol(ankL.map(p => p.y), 7, 3);
  const ankRy = savgol(ankR.map(p => p.y), 7, 3);
  const prom = torsoPx * 0.08;
  const cL = findPeaks(ankLy, times, 0.14, prom);
  const cR = findPeaks(ankRy, times, 0.14, prom);
  const contacts = [...cL.map(c => ({ ...c, foot: 'L' })), ...cR.map(c => ({ ...c, foot: 'R' }))].sort((a, b) => a.t - b.t);

  let cadence = NaN, stepTimes = [];
  if (contacts.length >= 3) {
    for (let i = 1; i < contacts.length; i++) stepTimes.push(contacts[i].t - contacts[i - 1].t);
    const st = median(stepTimes);
    if (st > 0.08 && st < 0.6) cadence = 1 / st;
  }

  /* --- step symmetry (L→R vs R→L intervals) --- */
  let stepSym = NaN;
  if (contacts.length >= 4) {
    const lr = [], rl = [];
    for (let i = 1; i < contacts.length; i++) {
      const gap = contacts[i].t - contacts[i - 1].t;
      if (gap > 0.6) continue;
      (contacts[i - 1].foot === 'L' ? lr : rl).push(gap);
    }
    const a = median(lr), b = median(rl);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) stepSym = (Math.min(a, b) / Math.max(a, b)) * 100;
  }

  /* --- trunk lean (positive = leaning into the run) --- */
  const leanSeries = frames.map((_, i) => signedLean(hipC[i], shC[i], dir));
  const leanSm = savgol(leanSeries, 9, 3);
  const leanMean = median(leanSm);
  const nEarly = Math.max(2, Math.round(leanSm.length * 0.25));
  const leanStart = median(leanSm.slice(0, nEarly));
  const leanEnd = median(leanSm.slice(-nEarly));

  /* --- knee drive: peak thigh angle from vertical-down --- */
  const thighL = frames.map((_, i) => angleFromDown(hipL[i], kneeL[i]));
  const thighR = frames.map((_, i) => angleFromDown(hipR[i], kneeR[i]));
  const kneeDriveL = pct(thighL, 92), kneeDriveR = pct(thighR, 92);
  const kneeDrive = mean([kneeDriveL, kneeDriveR]);
  const kneeSym = Number.isFinite(kneeDriveL) && Number.isFinite(kneeDriveR) && Math.max(kneeDriveL, kneeDriveR) > 0
    ? (Math.min(kneeDriveL, kneeDriveR) / Math.max(kneeDriveL, kneeDriveR)) * 100 : NaN;

  /* --- arm swing: range of upper-arm angle each side --- */
  const armAngL = frames.map((_, i) => signedLean(shL[i], elbL[i], dir));
  const armAngR = frames.map((_, i) => signedLean(shR[i], elbR[i], dir));
  const rangeOf = a => pct(a, 95) - pct(a, 5);
  const armRangeL = rangeOf(armAngL), armRangeR = rangeOf(armAngR);
  const armSym = Number.isFinite(armRangeL) && Number.isFinite(armRangeR) && Math.max(armRangeL, armRangeR) > 0
    ? (Math.min(armRangeL, armRangeR) / Math.max(armRangeL, armRangeR)) * 100 : NaN;

  /* --- dot-product joint angles (Savitzky-Golay smoothed) --- */
  const kneeAngL = savgol(frames.map((_, i) => jointAngle(hipL[i], kneeL[i], ankL[i])), 7, 3);
  const kneeAngR = savgol(frames.map((_, i) => jointAngle(hipR[i], kneeR[i], ankR[i])), 7, 3);
  const finite = a => a.filter(Number.isFinite);
  const kneeFlexMin = mean([Math.min(...finite(kneeAngL)), Math.min(...finite(kneeAngR))]);  // tightest knee = peak drive
  const hipAngL = savgol(frames.map((_, i) => jointAngle(shL[i], hipL[i], kneeL[i])), 7, 3);
  const hipAngR = savgol(frames.map((_, i) => jointAngle(shR[i], hipR[i], kneeR[i])), 7, 3);
  const hipExtension = mean([Math.max(...finite(hipAngL)), Math.max(...finite(hipAngR))]);   // max = leg driven behind

  /* --- speed & stride (only from a still camera) --- */
  const cameraPanned = travelFrac < 0.25 && contacts.length >= 4;
  let speed = NaN, strideLen = NaN, speedNote = null;
  if (cameraPanned) {
    speedNote = 'Camera followed you, so speed and stride length cannot be measured from this clip.';
  } else if (!mPerPx) {
    speedNote = 'Add your height in Profile to get speed and stride length estimates.';
  } else {
    const win = Math.max(2, Math.round(frames.length * 0.15));
    const v = [];
    for (let i = win; i < frames.length; i++) {
      const dtt = times[i] - times[i - win];
      if (dtt > 0) v.push(Math.abs(hipX[i] - hipX[i - win]) * mPerPx / dtt);
    }
    speed = pct(v, 90);
    if (Number.isFinite(cadence) && Number.isFinite(speed)) strideLen = (speed / cadence) * 2;
  }

  const strideRatio = Number.isFinite(strideLen) && realH ? strideLen / realH : NaN;

  return {
    sprintType: type,
    duration: +track.duration.toFixed(2),
    stepsDetected: contacts.length,
    contacts: contacts.map(c => ({ t: +c.t.toFixed(3), foot: c.foot })),
    cadence: r2(cadence),
    stepSymmetryPct: r1(stepSym),
    trunkLeanDeg: r1(leanMean),
    trunkLeanStartDeg: r1(leanStart),
    trunkLeanEndDeg: r1(leanEnd),
    kneeDriveDeg: r1(kneeDrive),
    kneeDriveLeftDeg: r1(kneeDriveL),
    kneeDriveRightDeg: r1(kneeDriveR),
    kneeSymmetryPct: r1(kneeSym),
    armSwingRangeLeftDeg: r1(armRangeL),
    armSwingRangeRightDeg: r1(armRangeR),
    armSymmetryPct: r1(armSym),
    kneeFlexMinDeg: r1(kneeFlexMin),
    hipExtensionDeg: r1(hipExtension),
    estTopSpeedMps: r2(speed),
    estStrideLengthM: r2(strideLen),
    strideToHeightRatio: r2(strideRatio),
    heightUsedM: realH ? +realH.toFixed(2) : null,
    speedNote,
    cameraPanned,
    trackingCoverage: r2(track.frames.filter(f => f.lm).length / track.frames.length),
    view: 'side',
    sourceFps: r1(track.fps),
    confidence: conf.score,
    cameraWarnings: conf.warnings,
    detectedView: conf.detectedView,
    orientationRatio: conf.orientationRatio,
  };
}

/* ---------------- metrics (frontal view) ---------------- */
/* Front/back camera: lateral mechanics the side view can't see —
   knee valgus (inward collapse), torso side-to-side sway, arm crossover. */
function computeFrontMetrics(track, type, profile) {
  const frames = track.frames.filter(f => f.lm);
  const P = i => frames.map(f => px(f.lm[i], track));
  const conf = captureConfidence(track, 'front');

  const hipL = P(L.lHip), hipR = P(L.rHip), kneeL = P(L.lKnee), kneeR = P(L.rKnee);
  const ankL = P(L.lAnkle), ankR = P(L.rAnkle), shL = P(L.lShoulder), shR = P(L.rShoulder);
  const wrL = P(L.lWrist), wrR = P(L.rWrist);
  const hipW = median(frames.map((_, i) => Math.abs(hipL[i].x - hipR[i].x))) || 1;
  const shW = median(frames.map((_, i) => Math.abs(shL[i].x - shR[i].x))) || 1;

  // knee valgus: horizontal offset of knee INSIDE the hip→ankle line, as degrees of deviation
  const valgusDeg = side => {
    const hp = side === 'L' ? hipL : hipR, kn = side === 'L' ? kneeL : kneeR, an = side === 'L' ? ankL : ankR;
    const inward = side === 'L' ? 1 : -1;   // left knee caves toward +x(right); mirror for right
    const dev = frames.map((_, i) => {
      const legLen = Math.hypot(an[i].x - hp[i].x, an[i].y - hp[i].y) || 1;
      // expected knee x on the hip-ankle line at knee's height
      const t = (kn[i].y - hp[i].y) / ((an[i].y - hp[i].y) || 1);
      const lineX = hp[i].x + t * (an[i].x - hp[i].x);
      const off = (kn[i].x - lineX) * inward;      // positive = knee caved inward toward midline
      return Math.atan2(off, legLen * 0.5) * 180 / Math.PI;
    });
    return pct(savgol(dev, 7, 3), 85);             // sustained inward collapse, not one jitter
  };
  const valgusL = valgusDeg('L'), valgusR = valgusDeg('R');
  const valgus = mean([valgusL, valgusR]);

  // torso sway: frontal lean of the trunk left/right of vertical, peak-to-peak
  const shC = frames.map((_, i) => mid(shL[i], shR[i]));
  const hipC = frames.map((_, i) => mid(hipL[i], hipR[i]));
  const swayS = savgol(frames.map((_, i) => Math.atan2(shC[i].x - hipC[i].x, -(shC[i].y - hipC[i].y)) * 180 / Math.PI), 9, 3);
  const swayAmp = (pct(swayS, 95) - pct(swayS, 5)) / 2;

  // arm crossover: how far each wrist crosses the body midline (hip centre), as % of shoulder width
  const midX = frames.map((_, i) => hipC[i].x);
  const crossFrac = side => {
    const wr = side === 'L' ? wrL : wrR, inward = side === 'L' ? 1 : -1;
    const c = frames.map((_, i) => Math.max(0, (wr[i].x - midX[i]) * inward)); // wrist past midline toward other side
    return pct(c, 90) / shW * 100;
  };
  const crossover = mean([crossFrac('L'), crossFrac('R')]);

  return {
    sprintType: type, view: 'front',
    duration: +track.duration.toFixed(2),
    kneeValgusDeg: r1(valgus), kneeValgusLeftDeg: r1(valgusL), kneeValgusRightDeg: r1(valgusR),
    torsoSwayDeg: r1(swayAmp),
    armCrossoverPct: r1(crossover),
    trackingCoverage: r2(frames.length / track.frames.length),
    sourceFps: r1(track.fps),
    confidence: conf.score,
    cameraWarnings: conf.warnings,
    detectedView: conf.detectedView,
    orientationRatio: conf.orientationRatio,
  };
}
const r1 = v => (Number.isFinite(v) ? +v.toFixed(1) : null);
const r2 = v => (Number.isFinite(v) ? +v.toFixed(2) : null);

/* Per-metric read against the ideal band for this sprint type.
   Turns a bare number into a judgement the athlete can act on. */
function evaluateMetrics(m) {
  const ideal = SPRINT_TYPES[m.sprintType].ideal || {};
  const g = [];
  const add = (label, value, unit, band, scale, hint) => {
    if (value === null || value === undefined || !band) return;
    const [lo, hi] = band, [min, max] = scale;
    const status = value < lo ? 'low' : value > hi ? 'high' : 'in';
    g.push({ label, value, unit, lo, hi, min, max, status, hint });
  };

  add('Cadence', m.cadence, '/s', ideal.cadence, [2.8, 5.8], 'Steps per second');
  if (ideal.lean) add('Trunk lean', m.trunkLeanDeg, '°', ideal.lean, [-10, 45], 'Upright is faster at top speed');
  if (ideal.leanStart) add('Lean, drive phase', m.trunkLeanStartDeg, '°', ideal.leanStart, [0, 60], 'Forward lean off the start');
  if (ideal.leanEnd) add('Lean, final phase', m.trunkLeanEndDeg, '°', ideal.leanEnd, [-5, 45], 'Should rise toward upright');
  add('Knee drive', m.kneeDriveDeg, '°', ideal.kneeDrive, [20, 110], '90° means thigh parallel to ground');
  add('Step symmetry', m.stepSymmetryPct, '%', [90, 100], [60, 100], 'Even timing left to right');
  add('Arm symmetry', m.armSymmetryPct, '%', ideal.armSym || [88, 100], [50, 100], 'Matched swing both sides');
  add('Knee flex (drive)', m.kneeFlexMinDeg, '°', degTight(m), [30, 130], 'Tighter knee = faster leg turnover');
  add('Hip extension', m.hipExtensionDeg, '°', [155, 190], [120, 200], 'Full drive of the leg behind you');
  add('Knee symmetry', m.kneeSymmetryPct, '%', [90, 100], [60, 100], 'Matched drive both sides');
  return g;
}
// tightest-knee target shifts a little by phase (accel knee stays more flexed under load)
function degTight(m) { return m.sprintType === 'acceleration' ? [20, 45] : [25, 55]; }

/* frontal-view gauges */
function evaluateFront(m) {
  const g = [];
  const add = (label, value, unit, band, scale, hint) => {
    if (value === null || value === undefined) return;
    const [lo, hi] = band, [min, max] = scale;
    const status = value < lo ? 'low' : value > hi ? 'high' : 'in';
    g.push({ label, value, unit, lo, hi, min, max, status, hint });
  };
  add('Knee valgus', m.kneeValgusDeg, '°', [-5, 8], [-15, 30], 'Knee tracking over the foot (lower is safer)');
  add('Torso sway', m.torsoSwayDeg, '°', [0, 5], [0, 20], 'Side-to-side lean wastes forward energy');
  add('Arm crossover', m.armCrossoverPct, '%', [0, 12], [0, 60], 'Arms drive front-to-back, not across the body');
  return g;
}

/* rule-based benchmark alerts — deterministic text from the same bands the
   gauges use, so the athlete gets hard pass/flag calls alongside the AI coach */
function benchmarkAlerts(gauges) {
  return gauges.filter(g => g.status !== 'in').map(g => {
    const dir = g.status === 'low' ? 'below' : 'above';
    const target = `${g.lo}–${g.hi}${g.unit}`;
    return { label: g.label, status: g.status, text: `${g.label} ${g.value}${g.unit} is ${dir} the ${target} target.` };
  });
}

/* ---------------- coach prompt ---------------- */
function analysisSystemPrompt(view = 'side') {
  return `You are "Night Match", an elite sprint mechanics coach analysing ONE athlete's run.
${typeof profileSummary === 'function' ? profileSummary() : ''}

You are given objective measurements extracted from ${view === 'front' ? 'a FRONT/BACK' : 'a SIDE-ON'} phone video by a pose-tracking model. Read them like a coach reading a force plate: the numbers are real but imperfect.
${view === 'front'
  ? 'This is the frontal view — coach ONLY lateral mechanics (knee valgus, torso sway, arm crossover). Do not mention stride, cadence, speed or forward lean; those need the side view.'
  : 'This is the side view — the reference angle for stride, cadence, joint angles and lean.'}
If capture confidence is low, factor that in and hedge — a warned camera setup makes angles less certain.

RULES
- Base every claim on the measurements provided. Never invent numbers or describe things the data cannot show (you cannot see facial expression, shoe type, surface, or effort level).
- If a metric is null, it was not measurable — do not comment on it.
- Metrics labelled estimated (speed, stride length) are approximate; hedge accordingly.
- Rank fixes by how much speed they would actually buy THIS athlete, given their age, level and position.
- Be specific and physical. "Drive your knee to hip height" not "improve your form".
- Keep the tone sharp, direct and encouraging. No filler.
- Age-appropriate and safe for their level.

Return ONLY valid JSON, no markdown, in exactly this shape:
{
  "headline": "one punchy sentence summarising the run",
  "strengths": ["1-3 short specific things the data shows they do well"],
  "fixes": [
    {
      "rank": 1,
      "title": "short imperative fix, max 6 words",
      "impact": "high" | "medium" | "low",
      "observed": "the measurement that shows this, quoted with its number",
      "why": "one sentence on what it costs them in speed or efficiency",
      "drill": "one concrete drill with sets/reps or time"
    }
  ],
  "coachNote": "2-3 sentences of direct coaching tying it to their goals and position"
}
Give exactly 3 fixes, ranked 1-3 by impact.`;
}

function metricsBrief(m, alerts) {
  const t = SPRINT_TYPES[m.sprintType];
  const confLine = `Capture confidence: ${Math.round((m.confidence ?? 1) * 100)}%${m.cameraWarnings?.length ? ' — ' + m.cameraWarnings.join(' ') : ''}`;
  let lines;
  if (m.view === 'front') {
    lines = [
      `View: FRONTAL (${t.name}). This camera sees lateral mechanics only — do not comment on stride, cadence, speed or forward lean.`,
      confLine, '',
      'MEASURED (frontal):',
      `- Knee valgus (inward collapse): ${fmt(m.kneeValgusDeg, '°')} (0° = knee tracks over foot; higher = caving in) · L ${fmt(m.kneeValgusLeftDeg, '°')} / R ${fmt(m.kneeValgusRightDeg, '°')}`,
      `- Torso side-to-side sway: ${fmt(m.torsoSwayDeg, '° of lateral lean')}`,
      `- Arm crossover past midline: ${fmt(m.armCrossoverPct, '% of shoulder width')}`,
    ];
  } else {
    lines = [
      `View: SIDE-ON (${t.name}, ${t.range})`,
      `Clip: ${m.duration}s · steps: ${m.stepsDetected} · tracking coverage: ${Math.round(m.trackingCoverage * 100)}% · source ~${m.sourceFps}fps`,
      confLine, '',
      'MEASURED (reliable):',
      `- Cadence: ${fmt(m.cadence, 'steps/sec')}`,
      `- Step timing symmetry: ${fmt(m.stepSymmetryPct, '%')} (100% = perfectly even L/R)`,
      `- Trunk lean whole run: ${fmt(m.trunkLeanDeg, '°')} · first quarter ${fmt(m.trunkLeanStartDeg, '°')} · final quarter ${fmt(m.trunkLeanEndDeg, '°')} (positive = into the run)`,
      `- Peak knee drive (thigh from vertical): ${fmt(m.kneeDriveDeg, '°')} · L ${fmt(m.kneeDriveLeftDeg, '°')} / R ${fmt(m.kneeDriveRightDeg, '°')} · symmetry ${fmt(m.kneeSymmetryPct, '%')}`,
      `- Tightest knee flexion (dot-product, lower = tighter): ${fmt(m.kneeFlexMinDeg, '°')}`,
      `- Peak hip extension: ${fmt(m.hipExtensionDeg, '°')}`,
      `- Arm swing range: L ${fmt(m.armSwingRangeLeftDeg, '°')} / R ${fmt(m.armSwingRangeRightDeg, '°')} · symmetry ${fmt(m.armSymmetryPct, '%')}`,
      '',
      'ESTIMATED (approximate — scaled from height, camera-angle sensitive):',
      `- Top speed: ${fmt(m.estTopSpeedMps, 'm/s')} · stride length ${fmt(m.estStrideLengthM, 'm')} · stride/height ${fmt(m.strideToHeightRatio, '')}`,
    ];
    if (m.speedNote) lines.push(`- NOTE: ${m.speedNote}`);
  }
  if (alerts?.length) {
    lines.push('', 'BENCHMARK FLAGS (already computed against elite bands — build your fixes around these):');
    alerts.forEach(a => lines.push(`- ${a.text}`));
  }
  lines.push('', `Coaching priorities: ${t.focus.join('; ')}.`);
  return lines.join('\n');
}
const fmt = (v, unit) => (v === null || v === undefined ? 'not measurable' : `${v}${unit ? ' ' + unit : ''}`);

/* ---------------- orchestrator ---------------- */
async function runAnalysis(file, type, profile, onStatus, view = 'side') {
  const track = await extractPose(file, onStatus, { fps: 60 });

  const quality = gradeCapture(track);
  if (!quality.ok) return { blocked: true, quality, track };

  const metrics = view === 'front'
    ? computeFrontMetrics(track, type, profile)
    : computeMetrics(track, type, profile);

  if (view === 'side' && (!Number.isFinite(metrics.cadence) || metrics.stepsDetected < 3)) {
    return {
      blocked: true, track,
      quality: {
        ok: false,
        issues: [{
          title: 'Not enough running strides detected',
          fix: 'Make sure the clip shows you at speed for at least 3–4 strides, filmed side-on with your feet visible.',
        }],
      },
    };
  }
  if (view === 'front' && metrics.kneeValgusDeg === null && metrics.torsoSwayDeg === null) {
    return { blocked: true, track, quality: { ok: false, issues: [{ title: 'Couldn’t read your lower body from the front', fix: 'Face the camera straight down the lane, full body in frame, in good light.' }] } };
  }

  const gauges = view === 'front' ? evaluateFront(metrics) : evaluateMetrics(metrics);
  const alerts = benchmarkAlerts(gauges);

  onStatus?.('Coach is reading your mechanics…', 0.92, 3);
  const { text } = await callGemini(analysisSystemPrompt(view), metricsBrief(metrics, alerts), false, true);
  let report;
  try { report = JSON.parse(cleanJSON(text)); }
  catch { throw new Error('The coach returned an unreadable report. Try again.'); }

  return { blocked: false, metrics, report, track, quality, gauges, alerts };
}

/* =====================================================================
   ANALYZE VIEW — controller
   ===================================================================== */
const az = { type: 'acceleration', view: 'side', capture: 'tripod', busy: false, cancelled: false, file: null, last: null };

// strict camera rules, shown for every clip (warn-but-proceed enforces softly)
const CAMERA_RULES = [
  'Square to the lane — a true 90° angle. Any diagonal skews the joint angles.',
  'Lens at hip height (~1 m). Too high or too low distorts vertical measurements.',
  'Camera 5–7 m from the lane so 3–4 strides fit without panning.',
  'Dead-still tripod — a panning or shaky camera breaks speed and stride length.',
  'Film at 60fps or higher (slo-mo); fast shutter (1/500s+) keeps the feet sharp.',
];
const FRAMING = {
  side: {
    lead: 'Side-on is the reference angle — it reads stride, cadence, joint angles and lean.',
    steps: [
      'Set the tripod square to your lane, hip height, 5–7 m to the side.',
      'Frame 3–4 full strides with your whole body in shot the entire time.',
      'Start recording, then run through the zone at full effort.',
      'Keep the clip under ~8 seconds. Slo-mo strongly preferred.',
    ],
  },
  front: {
    lead: 'Front/back view catches what the side can’t: knee collapse, torso sway and arm crossover.',
    steps: [
      'Set the tripod straight down the lane, ahead of or behind you, hip height, 5–7 m out.',
      'Run directly toward or away from the lens, staying centred and fully in frame.',
      'Start recording, run at full effort through the zone.',
      'This view does not measure stride, cadence or speed — use side-on for those.',
    ],
  },
};

function initAnalyze() {
  renderTypes();
  renderGuide();

  $('#azTypes').addEventListener('click', e => {
    const card = e.target.closest('[data-type]'); if (!card) return;
    az.type = card.dataset.type; renderTypes(); renderGuide();
  });

  const viewSeg = $('.az-view-seg');
  if (viewSeg) viewSeg.addEventListener('click', e => {
    const b = e.target.closest('.seg-btn'); if (!b) return;
    $$('.seg-btn', viewSeg).forEach(x => x.classList.remove('on'));
    b.classList.add('on'); az.view = b.dataset.view; renderGuide();
  });

  const seg = $('.az-seg');
  seg.addEventListener('click', e => {
    const b = e.target.closest('.seg-btn'); if (!b) return;
    $$('.seg-btn', seg).forEach(x => x.classList.remove('on'));
    b.classList.add('on'); az.capture = b.dataset.val; renderGuide();
  });

  const drop = $('#azDrop'), input = $('#azFile');
  input.addEventListener('change', () => { if (input.files[0]) startAnalysis(input.files[0]); });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => {
    const f = e.dataTransfer?.files?.[0];
    if (f) { if (/^video\//.test(f.type)) startAnalysis(f); else toast('That file is not a video', false); }
  });

  $('#azCancel').addEventListener('click', () => { az.cancelled = true; resetAnalyze(); });
}

function renderTypes() {
  $('#azTypes').innerHTML = Object.values(SPRINT_TYPES).map(t => `
    <button type="button" class="az-type ${t.id === az.type ? 'on' : ''}" data-type="${t.id}">
      <span class="az-type-name">${t.name}</span>
      <span class="az-type-range">${t.range}</span>
      <span class="az-type-blurb">${esc(t.blurb)}</span>
    </button>`).join('');
}

function renderGuide() {
  const fr = FRAMING[az.view], c = CAPTURE_SETUPS[az.capture];
  $('#azGuide').innerHTML = `
    <div class="az-guide-lead">${esc(fr.lead)}</div>
    <ol class="az-guide-list">${fr.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
    <div class="az-guide-tips">
      <div class="az-guide-tips-h">Camera rules</div>
      <ul>${CAMERA_RULES.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
    </div>
    <div class="az-guide-tips">
      <div class="az-guide-tips-h">${esc(c.name)}</div>
      <ul>${c.tips.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
    </div>`;
}

async function startAnalysis(file) {
  if (az.busy) return;
  if (!canCoach()) { openSettings(); toast('Add your API key to analyse clips', false); return; }
  if (!/^video\//.test(file.type)) { toast('That file is not a video', false); return; }

  az.busy = true; az.cancelled = false; az.file = file;
  $('#azSetup').classList.add('hidden');
  $('#azResult').classList.add('hidden');
  $('#azWorking').classList.remove('hidden');
  $$('#azPhases li').forEach(li => li.classList.remove('on', 'done'));
  setStatus('Reading your clip…', 0.02, 0);

  try {
    const profile = store.get('profile');
    const out = await runAnalysis(file, az.type, profile, setStatus, az.view);
    if (az.cancelled) return;
    az.last = out;
    if (out.blocked) renderBlocked(out);
    else renderReport(out, file);
  } catch (e) {
    if (!az.cancelled) renderError(e.message);
  } finally {
    az.busy = false;
    $('#azWorking').classList.add('hidden');
  }
}

function setStatus(msg, frac, phase) {
  const s = $('#azStatus'); if (s) s.textContent = msg;
  if (typeof frac === 'number') { const b = $('#azBar'); if (b) b.style.width = Math.round(frac * 100) + '%'; }
  if (typeof phase === 'number') {
    $$('#azPhases li').forEach(li => {
      const p = +li.dataset.phase;
      li.classList.toggle('on', p === phase);
      li.classList.toggle('done', p < phase);
    });
  }
}

function resetAnalyze() {
  az.busy = false;
  $('#azWorking').classList.add('hidden');
  $('#azResult').classList.add('hidden');
  $('#azSetup').classList.remove('hidden');
  $('#azFile').value = '';
  $('#azBar').style.width = '0%';
}

function renderError(msg) {
  const el = $('#azResult');
  el.classList.remove('hidden');
  el.innerHTML = `<div class="ans-quick" style="border-color:rgba(255,122,107,.4)">${WARN}${esc(msg)}</div>
    <button class="btn btn-ghost az-again">Try another clip</button>`;
  $('.az-again', el).addEventListener('click', resetAnalyze);
}

function renderBlocked(out) {
  const el = $('#azResult');
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="az-blocked">
      <div class="az-blocked-h">${WARN} This clip can't be analysed accurately</div>
      <p class="az-blocked-sub">Rather than give you coaching built on bad data, here's exactly what to change:</p>
      <ul class="az-issues">
        ${out.quality.issues.map(i => `<li><b>${esc(i.title)}</b><span>${esc(i.fix)}</span></li>`).join('')}
      </ul>
      <button class="btn btn-accent az-again">Film it again</button>
    </div>`;
  $('.az-again', el).addEventListener('click', resetAnalyze);
}

function renderReport(out, file) {
  const { metrics: m, report: r } = out;
  const t = SPRINT_TYPES[m.sprintType];
  const front = m.view === 'front';
  const el = $('#azResult');
  el.classList.remove('hidden');

  const impactClass = i => ({ high: 'hi', medium: 'md', low: 'lo' }[String(i || '').toLowerCase()] || 'md');
  const gauges = out.gauges || (front ? evaluateFront(m) : evaluateMetrics(m));
  const alerts = out.alerts || benchmarkAlerts(gauges);
  const est = front ? [] : [
    ['Top speed', m.estTopSpeedMps, 'm/s'],
    ['Stride length', m.estStrideLengthM, 'm'],
    ['Stride ÷ height', m.strideToHeightRatio, ''],
  ].filter(x => x[1] !== null && x[1] !== undefined);

  const conf = m.confidence ?? 1;
  const confBanner = (m.cameraWarnings?.length)
    ? `<div class="az-conf az-conf--${conf < 0.6 ? 'low' : 'mid'}">
        <div class="az-conf-h">${WARN}Capture confidence ${Math.round(conf * 100)}% — results shown, read them with this in mind</div>
        <ul>${m.cameraWarnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
       </div>` : '';

  const benchBlock = alerts.length ? `
    <div class="az-bench">
      <div class="az-sec-h"><span>Benchmark flags</span><em>vs elite bands</em></div>
      <div class="az-bench-chips">${alerts.map(a => `<span class="az-chip az-chip--${a.status}">${esc(a.text)}</span>`).join('')}</div>
    </div>` : `
    <div class="az-bench"><div class="az-bench-clear">${SVG.target} Every measured metric is inside its elite band.</div></div>`;

  const tagText = front ? `Frontal · ${t.name}` : `${t.name} · ${t.range}`;

  el.innerHTML = `
    <div class="az-report">
      <header class="az-headline">
        <span class="az-tag">${esc(tagText)}</span>
        <h2>${esc(r.headline || 'Your run, measured.')}</h2>
      </header>

      ${confBanner}
      ${front ? '' : gaitStripHTML(m)}

      <div class="az-cols">
        <div class="az-col-main">
          <div class="az-fixes">
            <div class="az-sec-h">${SVG.zap}<span>Fix these, in order</span></div>
            ${(r.fixes || []).map(f => `
              <article class="az-fix">
                <div class="az-fix-rank">${String(f.rank ?? '').padStart(2, '0')}</div>
                <div class="az-fix-body">
                  <div class="az-fix-top">
                    <h3>${esc(f.title || '')}</h3>
                    <span class="az-impact az-impact--${impactClass(f.impact)}">${esc(f.impact || '')}</span>
                  </div>
                  ${f.observed ? `<p class="az-fix-obs">${esc(f.observed)}</p>` : ''}
                  ${f.why ? `<p class="az-fix-why">${esc(f.why)}</p>` : ''}
                  ${f.drill ? `<p class="az-fix-drill"><span>Drill</span>${esc(f.drill)}</p>` : ''}
                </div>
              </article>`).join('')}
          </div>

          ${benchBlock}
          ${r.coachNote ? `<div class="ans-quick">${esc(r.coachNote)}</div>` : ''}
        </div>

        <aside class="az-col-side">
          ${r.strengths?.length ? `<div class="az-strengths">
            <div class="az-sec-h az-sec-h--good">${SVG.target}<span>Working well</span></div>
            <ul class="az-str-list">${r.strengths.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
          </div>` : ''}

          <div class="az-gauges">
            <div class="az-sec-h"><span>Measured</span><em>${front ? 'lateral' : 'vs ' + esc(t.name.toLowerCase())} target</em></div>
            ${gauges.map(gaugeHTML).join('')}
          </div>

          ${est.length ? `<div class="az-est">
            <div class="az-sec-h"><span>Estimated</span><em>approx</em></div>
            <div class="az-est-grid">
              ${est.map(([k, v, u]) => `<div class="az-est-item"><span class="az-est-v">${v}<small>${u}</small></span><span class="az-est-k">${k}</span></div>`).join('')}
            </div>
          </div>` : ''}

          <div class="az-media">
            <div class="az-video-wrap">
              <video id="azVideo" class="az-video" playsinline controls loop></video>
              <canvas id="azSkeleton" class="az-skeleton hidden"></canvas>
            </div>
            <label class="az-toggle" for="azSkelToggle">
              <input type="checkbox" id="azSkelToggle" class="switch" />
              <span>Show tracking skeleton</span>
            </label>
          </div>

          <p class="az-note">${m.speedNote ? esc(m.speedNote) + ' ' : ''}${front
            ? `Frontal read of ${Math.round(m.trackingCoverage * 100)}% tracked frames. Lateral angles only — no stride, cadence or speed from this view.`
            : `Read from ${m.stepsDetected} foot contacts over ${m.duration}s, ${Math.round(m.trackingCoverage * 100)}% tracked. Angles and cadence are measured with Savitzky-Golay smoothing; speed and stride are estimated from your height.`}</p>
        </aside>
      </div>

      <div class="ans-actions">
        <button class="icon-btn az-export"><svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>Download annotated clip</button>
        <button class="icon-btn az-save"><svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>Save</button>
        <button class="icon-btn az-again"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.36 2.64L3 8"/><path d="M3 3v5h5"/></svg>Analyse another</button>
      </div>
    </div>`;

  const video = $('#azVideo', el);
  video.src = URL.createObjectURL(file);
  const canvas = $('#azSkeleton', el);
  const toggle = $('#azSkelToggle', el);
  toggle.addEventListener('change', () => {
    canvas.classList.toggle('hidden', !toggle.checked);
    if (toggle.checked) drawSkeletonLoop(video, canvas, out.track);
  });

  $('.az-export', el).addEventListener('click', e => exportAnnotated(out, file, e.currentTarget));
  $('.az-again', el).addEventListener('click', resetAnalyze);
  $('.az-save', el).addEventListener('click', e => {
    const saved = store.get('saved', []);
    saved.unshift({
      id: uid(), ts: Date.now(), type: 'analysis',
      question: `${t.name}${front ? ' (frontal)' : ''} analysis — ${r.headline || ''}`.trim(),
      analysis: { metrics: m, report: r },
    });
    store.set('saved', saved);
    e.currentTarget.classList.add('saved');
    e.currentTarget.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>Saved`;
    toast('Analysis saved');
  });
}

/* --- signature: the gait strip ---------------------------------------
   Every detected foot contact on a timeline, left above the line and
   right below it. Cadence and left/right asymmetry become visible at a
   glance — the same read a coach gets from a contact-mat trace.        */
function gaitStripHTML(m) {
  const c = m.contacts || [];
  if (c.length < 3) return '';
  const dur = m.duration || 1;
  const X = t => 2 + (t / dur) * 96;   // % across the plot, with margins

  const ticks = c.map((k, i) => {
    const up = k.foot === 'L';
    const gap = i > 0 ? (k.t - c[i - 1].t) : null;
    const label = gap
      ? `<span class="az-gap az-gap--${up ? 'l' : 'r'}" style="left:${(X(k.t) + X(c[i - 1].t)) / 2}%">${gap.toFixed(2)}s</span>`
      : '';
    return `<span class="az-tick az-tick--${up ? 'l' : 'r'}" style="left:${X(k.t)}%;--d:${i * 45}ms"><i></i></span>${label}`;
  }).join('');

  return `<figure class="az-gait">
    <figcaption class="az-gait-cap">
      <span class="az-gait-t">Foot contacts</span>
      <span class="az-gait-legend"><i class="l"></i>Left<i class="r"></i>Right</span>
      <span class="az-gait-cad">${m.cadence ?? '—'}<small>steps/sec</small></span>
    </figcaption>
    <div class="az-gait-plot" role="img"
         aria-label="Timeline of ${c.length} foot contacts over ${dur.toFixed(1)} seconds, cadence ${m.cadence} steps per second">
      <span class="az-gait-axis"></span>
      ${ticks}
    </div>
    <div class="az-gait-scale"><span>0s</span><span>${dur.toFixed(1)}s</span></div>
  </figure>`;
}

/* --- range gauge: your value against the target band ----------------- */
function gaugeHTML(g) {
  const span = g.max - g.min;
  const pos = v => Math.max(0, Math.min(100, ((v - g.min) / span) * 100));
  const bandL = pos(g.lo), bandW = Math.max(2, pos(g.hi) - pos(g.lo));
  const label = { in: 'on target', low: 'below target', high: 'above target' }[g.status];
  return `<div class="az-gauge az-gauge--${g.status}">
    <div class="az-gauge-top">
      <span class="az-gauge-k">${esc(g.label)}</span>
      <span class="az-gauge-v">${g.value}<small>${esc(g.unit)}</small></span>
    </div>
    <div class="az-gauge-track">
      <div class="az-gauge-band" style="left:${bandL}%;width:${bandW}%"></div>
      <div class="az-gauge-mark" style="left:${pos(g.value)}%"></div>
    </div>
    <div class="az-gauge-foot"><span class="az-gauge-status">${label}</span><span class="az-gauge-hint">${esc(g.hint || '')}</span></div>
  </div>`;
}

/* skeleton overlay */
const BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 31], [28, 32],
];
function drawSkeletonFrame(ctx, lm, w, h) {
  const X = p => p.x * w, Y = p => p.y * h;
  const lw = Math.max(2, w / 320);
  ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.strokeStyle = '#ff4d2e';
  ctx.shadowColor = 'rgba(255,77,46,.6)'; ctx.shadowBlur = lw * 3;
  for (const [a, b] of BONES) {
    const p = lm[a], q = lm[b];
    if (!p || !q || (p.visibility ?? 1) < 0.4 || (q.visibility ?? 1) < 0.4) continue;
    ctx.beginPath(); ctx.moveTo(X(p), Y(p)); ctx.lineTo(X(q), Y(q)); ctx.stroke();
  }
  ctx.shadowBlur = 0; ctx.fillStyle = '#ecefe9';
  for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    const p = lm[i]; if (!p || (p.visibility ?? 1) < 0.4) continue;
    ctx.beginPath(); ctx.arc(X(p), Y(p), lw * 1.3, 0, Math.PI * 2); ctx.fill();
  }
}
function drawSkeletonLoop(video, canvas, track) {
  const ctx = canvas.getContext('2d');
  let raf;
  const draw = () => {
    if (canvas.classList.contains('hidden')) { cancelAnimationFrame(raf); return; }
    const rect = video.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) { canvas.width = rect.width; canvas.height = rect.height; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const f = nearestFrame(track.frames, video.currentTime);
    if (f?.lm) drawSkeletonFrame(ctx, f.lm, canvas.width, canvas.height);
    raf = requestAnimationFrame(draw);
  };
  draw();
}
function nearestFrame(frames, t) {
  let best = null, bd = Infinity;
  for (const f of frames) { const d = Math.abs(f.t - t); if (d < bd) { bd = d; best = f; } }
  return bd < 0.2 ? best : null;
}

/* export an annotated .webm: original clip + skeleton + burned-in headline
   and the key benchmark flag, rendered live via canvas capture */
async function exportAnnotated(out, file, btn) {
  if (!window.MediaRecorder) { toast('This browser can’t export video', false); return; }
  const orig = btn.innerHTML; btn.disabled = true; btn.textContent = 'Rendering…';
  const { track, report: r, alerts } = out;
  const banner = (alerts && alerts[0]) ? alerts[0].text : (r.headline || '');
  let url;
  try {
    url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = url; video.muted = true; video.playsInline = true;
    await new Promise((res, rej) => { video.onloadeddata = res; video.onerror = () => rej(new Error('read fail')); setTimeout(() => rej(new Error('timeout')), 15000); });
    const w = Math.min(720, video.videoWidth || 720), scale = w / (video.videoWidth || w), h = Math.round((video.videoHeight || 405) * scale);
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(30);
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000 });
    const chunks = []; rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise(res => rec.onstop = res);
    rec.start();
    await video.play();
    await new Promise(resolve => {
      const step = () => {
        ctx.drawImage(video, 0, 0, w, h);
        const f = nearestFrame(track.frames, video.currentTime);
        if (f?.lm) drawSkeletonFrame(ctx, f.lm, w, h);
        const pad = Math.round(w * 0.03), fs = Math.max(13, Math.round(w * 0.032));
        ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
        const txt = banner.length > 64 ? banner.slice(0, 62) + '…' : banner;
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = 'rgba(8,9,11,.6)'; ctx.fillRect(0, h - fs - pad * 1.6, Math.min(w, tw + pad * 2), fs + pad * 1.4);
        ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(txt, pad, h - (fs + pad * 1.6) / 2 - 2);
        ctx.fillStyle = '#ff4d2e'; ctx.font = `600 ${Math.round(fs * 0.7)}px Inter, system-ui, sans-serif`;
        ctx.fillText('NIGHT MATCH', pad, pad);
        if (video.ended || video.paused) { resolve(); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      video.onended = () => resolve();
    });
    rec.stop(); await stopped;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `night-match-sprint-${Date.now()}.webm`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Annotated clip saved');
  } catch { toast('Could not render the clip', false); }
  finally { if (url) URL.revokeObjectURL(url); btn.disabled = false; btn.innerHTML = orig; }
}
