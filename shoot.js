/* ============================================================
   NIGHT MATCH — Shooting Analyzer
   Side-on strike → plant / contact / follow-through phases →
   body-mechanics metrics → ranked fixes. No ball tracking:
   at contact your foot IS at the ball, so plant offset comes
   free from pose alone. Video never leaves the device.
   Depends on analyze.js (pose model, geometry, gauges).
   ============================================================ */

/* ---------------- shot types ----------------
   gauges: [key, label, unit, targetBand, scale, hint]. `view` is the camera
   angle that reads the shot best (side profile vs directly behind). Bands
   differ per shot: a side-foot finish should swing shorter than a drive; a
   chip is meant to lean back; a curl wants an angled approach and wrap. */

// shared metrics for the directly-behind (frontal-plane) view. Approximate
// from a single 2D view, but the right angle for hip rotation & approach path.
const BEHIND_GAUGES = [
  ['hipRotationDeg', 'Hip rotation', '°', [20, 70], [0, 110], 'Open the hips through the ball'],
  ['chestSquareDeg', 'Chest tilt', '°', [0, 16], [0, 45], 'Chest over the ball, not thrown back'],
  ['plantLateralCm', 'Plant beside ball', 'cm', [6, 28], [-10, 55], 'Plant to the side of the ball, not on top'],
  ['approachAngleDeg', 'Approach angle', '°', [0, 45], [0, 70], 'Angled run helps you wrap the ball'],
  ['followSwingDeg', 'Follow direction', '°', [8, 60], [0, 100], 'Across the ball for curl, straight for power'],
  ['headMoveCm', 'Head movement', 'cm', [0, 14], [0, 30], 'Still head, clean strike'],
];

function sideGauges(over = {}) {
  const g = {
    plantOffsetCm: ['Plant offset', 'cm', [0, 20], [-15, 50], 'Level with the ball, not behind it'],
    kneeOverBallDeg: ['Knee over ball', '°', [5, 25], [-15, 45], 'Knee ahead of ankle keeps it down'],
    kneeExtensionDeg: ['Knee extension', '°', [120, 175], [80, 190], 'Snap the knee straight through impact'],
    trunkLeanDeg: ['Trunk lean', '°', [5, 25], [-20, 45], 'Chest over the ball, not leaning back'],
    backswingFlexDeg: ['Backswing knee bend', '°', [80, 120], [30, 150], 'Your power reservoir'],
    followThroughDeg: ['Follow-through', '°', [55, 90], [10, 110], 'Swing through, not at'],
    followHeightCm: ['Follow-through height', 'cm', [30, 90], [0, 140], 'Height the boot finishes at'],
    anklePointDeg: ['Ankle pointed', '°', [150, 185], [100, 200], '180° = foot in line with the shin'],
    ankleStabilityDeg: ['Ankle wobble', '°', [0, 8], [0, 25], 'Lower means locked'],
    headMoveCm: ['Head movement', 'cm', [0, 12], [0, 30], 'Still head, clean strike'],
    armBalanceDeg: ['Balance arm', '°', [15, 60], [0, 90], 'Opposite arm out to counter-balance'],
  };
  Object.assign(g, over);
  return Object.entries(g).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, ...v]);
}

const SHOT_TYPES = {
  instep: {
    id: 'instep', name: 'Instep drive', range: 'Laces · power', view: 'side',
    blurb: 'The power strike — laces through the ball, hips driving, full follow-through.',
    focus: ['Plant foot level with the ball', 'Knee over the ball to keep it down', 'Ankle locked and pointed', 'Full, high follow-through'],
    gauges: sideGauges(), gaugesBehind: BEHIND_GAUGES,
  },
  sidefoot: {
    id: 'sidefoot', name: 'Side-foot finish', range: 'Placement · accuracy', view: 'side',
    blurb: 'The accuracy finish — firm ankle, body over the ball, controlled swing to the corner.',
    focus: ['Plant foot level with the ball', 'Body compact and over the ball', 'Firm, stable ankle', 'Short, controlled follow-through'],
    gauges: sideGauges({
      plantOffsetCm: ['Plant offset', 'cm', [0, 25], [-15, 50], 'Level with the ball'],
      kneeOverBallDeg: ['Knee over ball', '°', [0, 20], [-15, 45], 'Stay compact over the strike'],
      kneeExtensionDeg: ['Knee extension', '°', [110, 160], [80, 190], 'Firm, guided — not a full snap'],
      trunkLeanDeg: ['Trunk lean', '°', [0, 20], [-20, 45], 'Upright-to-forward, never back'],
      backswingFlexDeg: ['Backswing knee bend', '°', [40, 90], [10, 140], 'Compact swing — placement over power'],
      followThroughDeg: ['Follow-through', '°', [30, 65], [0, 100], 'Short and controlled to target'],
      followHeightCm: ['Follow-through height', 'cm', [15, 60], [0, 120], 'Kept low and toward target'],
      anklePointDeg: undefined,
    }), gaugesBehind: BEHIND_GAUGES,
  },
  curl: {
    id: 'curl', name: 'Curled / finesse', range: 'Bend · placement', view: 'behind',
    blurb: 'Wrap across the ball with the inside of the foot to bend it into the far corner.',
    focus: ['Angled approach to the ball', 'Open the hips through contact', 'Strike across the ball with the instep-side', 'Wrap the follow-through across your body'],
    gauges: sideGauges({
      trunkLeanDeg: ['Trunk lean', '°', [0, 22], [-20, 45], 'Slight lean over/around the ball'],
      followThroughDeg: ['Follow-through', '°', [45, 85], [10, 110], 'Wrap up and across'],
      anklePointDeg: undefined,
    }), gaugesBehind: BEHIND_GAUGES,
  },
  volley: {
    id: 'volley', name: 'Volley', range: 'Aerial · timing', view: 'side',
    blurb: 'Strike the ball out of the air — knee over it, ankle locked, get on top to keep it down.',
    focus: ['Knee over the ball at contact', 'Ankle locked and firm', 'Chest over the ball to keep it down', 'Compact, controlled swing'],
    gauges: sideGauges({
      plantOffsetCm: undefined, plantFootAngleDeg: undefined,
      kneeOverBallDeg: ['Knee over ball', '°', [10, 35], [-10, 55], 'Get on top to keep it down'],
      kneeExtensionDeg: ['Knee extension', '°', [100, 155], [70, 190], 'Punch, don’t over-swing'],
      trunkLeanDeg: ['Trunk lean', '°', [8, 30], [-20, 50], 'Chest over the ball'],
      backswingFlexDeg: ['Knee cock', '°', [60, 110], [20, 150], 'Load the knee, short backlift'],
      followThroughDeg: ['Follow-through', '°', [35, 75], [0, 110], 'Controlled, not wild'],
    }), gaugesBehind: BEHIND_GAUGES,
  },
  chip: {
    id: 'chip', name: 'Chip / scoop', range: 'Lift · finesse', view: 'side',
    blurb: 'A short stab under the ball with a slight lean back to lift it over the keeper.',
    focus: ['Slight lean back to get under the ball', 'Short, stabbing swing — little follow-through', 'Firm ankle, wedge under the ball', 'Plant foot close and beside the ball'],
    gauges: sideGauges({
      kneeOverBallDeg: ['Knee position', '°', [-15, 10], [-40, 40], 'Knee back a touch to get under it'],
      kneeExtensionDeg: ['Knee extension', '°', [90, 140], [60, 180], 'Short stab, not a full snap'],
      trunkLeanDeg: ['Trunk lean', '°', [-20, 5], [-45, 30], 'Slight lean BACK is correct for a chip'],
      backswingFlexDeg: ['Backswing knee bend', '°', [30, 75], [10, 130], 'Short backlift'],
      followThroughDeg: ['Follow-through', '°', [10, 45], [0, 90], 'Almost none — a stab'],
      followHeightCm: ['Follow-through height', 'cm', [0, 40], [0, 110], 'Cut short deliberately'],
      anklePointDeg: undefined,
    }), gaugesBehind: BEHIND_GAUGES,
  },
  freekick: {
    id: 'freekick', name: 'Free kick', range: 'Dead ball · bend', view: 'behind',
    blurb: 'Dead-ball strike — settle, angled run-up, and either wrap it or drive through the middle.',
    focus: ['Consistent angled approach', 'Open hips through the ball', 'Clean plant beside the ball', 'Wrap or drive depending on the target'],
    gauges: sideGauges({ anklePointDeg: undefined }), gaugesBehind: BEHIND_GAUGES,
  },
  penalty: {
    id: 'penalty', name: 'Penalty', range: 'Placement · nerve', view: 'behind',
    blurb: 'Pick your spot and commit — a repeatable plant, still head and clean contact.',
    focus: ['Repeatable approach and plant', 'Still head through contact', 'Firm ankle, clean strike', 'Commit to the corner'],
    gauges: sideGauges({
      kneeOverBallDeg: ['Knee over ball', '°', [0, 25], [-15, 45], 'Keep it down and on target'],
      backswingFlexDeg: ['Backswing knee bend', '°', [50, 100], [10, 140], 'Controlled, repeatable'],
      followThroughDeg: ['Follow-through', '°', [35, 80], [0, 110], 'Through the ball to the corner'],
      anklePointDeg: undefined,
    }), gaugesBehind: BEHIND_GAUGES,
  },
};

// where you're shooting — short environment context (camera specifics live in SHOOT_FRAMING)
const SHOT_SETTINGS = {
  goal:  { id: 'goal',  name: 'Full goal',        note: 'Ball 12–20 yards out, dead centre. Net catches the ball so you can shoot freely.' },
  wall:  { id: 'wall',  name: 'Wall / rebounder', note: 'Tighter space — the ball comes back, so give yourself room and expect a rebound.' },
  field: { id: 'field', name: 'Open field',       note: 'Use a clean, uncluttered background — no one walking behind you.' },
};

// camera angle rules per view — CLOSE-UP and SLO-MO are enforced
const SHOOT_FRAMING = {
  side: {
    lead: 'Side profile — the reference angle for plant, knee, chest lean and follow-through.',
    steps: [
      'Phone square to your shooting line (a true 90° side angle), lens at hip height.',
      'Close up: 5–8 ft (1.5–2.5 m) from the ball so your body and the ball fill the frame.',
      'Keep 2–3 run-up steps and your whole body in shot, on a dead-still tripod.',
    ],
  },
  behind: {
    lead: 'Directly behind — the angle for hip rotation, approach path and plant placement. Best for curls, free kicks and penalties.',
    steps: [
      'Phone straight down your shooting line, directly behind you, lens at hip height.',
      'Close up: 5–8 ft (1.5–2.5 m) behind the ball so you and the ball fill the frame.',
      'Run straight through toward the ball, staying centred, on a dead-still tripod.',
    ],
  },
};
const SLOMO_RULE = 'Film every shot in slo-mo at 120fps or higher. Ball contact lasts ~10ms and blurs between frames at normal speed — clips that aren’t slow-motion are rejected.';

/* ---------------- source frame-rate estimate ----------------
   The browser can't read fps from the file, so estimate it: probe the clip
   at 300 Hz and count how many DISTINCT decoded frames fall in the window.
   ~120 distinct/sec ⇒ slo-mo; ~30–60 ⇒ normal speed. */
async function estimateSourceFps(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.src = url; v.muted = true; v.playsInline = true; v.preload = 'auto';
  try {
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('read')); setTimeout(() => rej(new Error('timeout')), 12000); });
    const dur = v.duration; if (!dur || !isFinite(dur)) return null;
    const win = Math.min(0.5, dur * 0.6);
    const start = Math.max(0, dur / 2 - win / 2);
    const probe = 1 / 300;
    const n = Math.min(150, Math.max(24, Math.round(win / probe)));
    const cw = 48, ch = 27;
    const cn = document.createElement('canvas'); cn.width = cw; cn.height = ch;
    const cx = cn.getContext('2d', { willReadFrequently: true });
    let prev = null, distinct = 0;
    for (let i = 0; i < n; i++) {
      await seekTo(v, start + i * probe);
      cx.drawImage(v, 0, 0, cw, ch);
      const d = cx.getImageData(0, 0, cw, ch).data;
      if (!prev) distinct = 1;
      else {
        let diff = 0, cnt = 0;
        for (let p = 0; p < d.length; p += 16) { diff += Math.abs(d[p] - prev[p]) + Math.abs(d[p + 1] - prev[p + 1]) + Math.abs(d[p + 2] - prev[p + 2]); cnt++; }
        if (diff / cnt > 6) distinct++;
      }
      prev = d.slice();
    }
    return distinct / (n * probe);
  } catch { return null; }
  finally { URL.revokeObjectURL(url); v.src = ''; }
}

/* ---------------- per-foot landmark map ---------------- */
function kickIdx(foot) {
  return foot === 'L'
    ? { ank: L.lAnkle, knee: L.lKnee, hip: L.lHip, toe: L.lToe, pAnk: L.rAnkle, pKnee: L.rKnee, pToe: L.rToe, oppSh: L.rShoulder, oppWr: L.rWrist }
    : { ank: L.rAnkle, knee: L.rKnee, hip: L.rHip, toe: L.rToe, pAnk: L.lAnkle, pKnee: L.lKnee, pToe: L.lToe, oppSh: L.lShoulder, oppWr: L.lWrist };
}

/* interior angle at b (degrees) */
function angleAt(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
  const d = (v1.x * v2.x + v1.y * v2.y) / ((Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)) || 1);
  return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
}
const sd = arr => {
  const a = arr.filter(Number.isFinite);
  if (a.length < 2) return NaN;
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};

/* ---------------- strike finding (coarse pass) ---------------- */
function kickSpeedSeries(track, foot) {
  const FR = track.frames.filter(f => f.lm);
  const K = kickIdx(foot);
  const torsoPx = median(FR.map(f => {
    const sh = mid(px(f.lm[L.lShoulder], track), px(f.lm[L.rShoulder], track));
    const hp = mid(px(f.lm[L.lHip], track), px(f.lm[L.rHip], track));
    return dist(sh, hp);
  }));
  const v = [NaN];
  for (let i = 1; i < FR.length; i++) {
    const dtt = FR[i].t - FR[i - 1].t;
    v.push(dtt > 0 ? dist(px(FR[i].lm[K.ank], track), px(FR[i - 1].lm[K.ank], track)) / dtt / (torsoPx || 1) : NaN);
  }
  return { FR, v: smooth(v, 3), torsoPx };
}

function findStrike(track, foot) {
  const { FR, v } = kickSpeedSeries(track, foot);
  if (FR.length < 8) return { ok: false };
  let peakI = -1, peak = -Infinity;
  for (let i = 2; i < v.length - 1; i++) if (Number.isFinite(v[i]) && v[i] > peak) { peak = v[i]; peakI = i; }
  const base = median(v);
  // a real strike is a sharp spike well above ordinary movement
  const ok = peakI > 0 && peak > Math.max(base * 4, 2.5);
  return { ok, tc: ok ? FR[peakI].t : null, peak, base };
}

/* front-on clips make every side-on angle meaningless — detect and refuse */
function sideOnCheck(track) {
  const FR = track.frames.filter(f => f.lm);
  const ratios = FR.map(f => {
    const shL = px(f.lm[L.lShoulder], track), shR = px(f.lm[L.rShoulder], track);
    const hp = mid(px(f.lm[L.lHip], track), px(f.lm[L.rHip], track));
    const torso = dist(mid(shL, shR), hp);
    return torso ? Math.abs(shL.x - shR.x) / torso : NaN;
  });
  const r = median(ratios);
  return { sideOn: !Number.isFinite(r) || r < 0.6, ratio: r };
}

/* ---------------- phase detection (refined pass) ---------------- */
function detectShotPhases(track, foot, forcedContactI = null) {
  const FR = track.frames.filter(f => f.lm);
  if (FR.length < 10) return null;
  const K = kickIdx(foot);
  const { v, torsoPx } = kickSpeedSeries(track, foot);

  let contactI = forcedContactI;
  if (contactI === null || contactI === undefined) {
    contactI = -1; let peak = -Infinity;
    for (let i = 2; i < v.length - 1; i++) if (Number.isFinite(v[i]) && v[i] > peak) { peak = v[i]; contactI = i; }
  }
  contactI = Math.max(2, Math.min(FR.length - 3, contactI));

  const fps = FR.length > 1 ? (FR.length - 1) / (FR[FR.length - 1].t - FR[0].t) : 30;
  const W = s => Math.max(1, Math.round(s * fps));

  // shooting direction: which way the kicking ankle travels through contact
  const x0 = px(FR[Math.max(0, contactI - 2)].lm[K.ank], track).x;
  const x1 = px(FR[Math.min(FR.length - 1, contactI + 1)].lm[K.ank], track).x;
  const dir = x1 - x0 >= 0 ? 1 : -1;

  // plant: last frame before contact where the plant ankle has gone still
  const pv = [NaN];
  for (let i = 1; i < FR.length; i++) {
    const dtt = FR[i].t - FR[i - 1].t;
    pv.push(dtt > 0 ? dist(px(FR[i].lm[K.pAnk], track), px(FR[i - 1].lm[K.pAnk], track)) / dtt / (torsoPx || 1) : NaN);
  }
  const pvs = smooth(pv, 3);
  const still = Math.max(0.35, pct(pvs.filter(Number.isFinite), 40));
  let plantI = null;
  for (let i = contactI - 1; i >= Math.max(1, contactI - W(0.5)); i--) {
    if (Number.isFinite(pvs[i]) && pvs[i] <= still) { plantI = i; break; }
  }
  if (plantI === null) plantI = Math.max(1, contactI - W(0.15));

  // backswing: deepest kicking-knee bend in the wind-up
  let backswingI = plantI, minKnee = Infinity;
  for (let i = Math.max(0, contactI - W(0.35)); i <= contactI; i++) {
    const f = FR[i].lm;
    const a = angleAt(px(f[K.hip], track), px(f[K.knee], track), px(f[K.ank], track));
    if (Number.isFinite(a) && a < minKnee) { minKnee = a; backswingI = i; }
  }

  // follow-through: highest thigh swing after contact
  let followI = Math.min(FR.length - 1, contactI + W(0.2)), maxThigh = -Infinity;
  for (let i = contactI + 1; i <= Math.min(FR.length - 1, contactI + W(0.5)); i++) {
    const f = FR[i].lm;
    const a = angleFromDown(px(f[K.hip], track), px(f[K.knee], track));
    if (Number.isFinite(a) && a > maxThigh) { maxThigh = a; followI = i; }
  }

  // contact sharpness: how many frames actually cover the strike
  const peakV = v[contactI];
  let sharp = 0;
  for (let i = Math.max(0, contactI - W(0.15)); i <= Math.min(v.length - 1, contactI + W(0.15)); i++) {
    if (Number.isFinite(v[i]) && v[i] > peakV * 0.6) sharp++;
  }

  return { FR, contactI, plantI, backswingI, followI, dir, torsoPx, fps, strikeSharpFrames: sharp, minKneeInterior: minKnee };
}

/* ---------------- metrics ---------------- */
function computeShotMetrics(track, ph, typeId, foot, profile) {
  const { FR, contactI, plantI, backswingI, followI, dir, torsoPx } = ph;
  const K = kickIdx(foot);
  const P = (i, idx) => px(FR[i].lm[idx], track);

  const realH = parseHeightMeters(profile?.height);
  const heightPx = torsoPx / 0.288;
  const mPerPx = realH && heightPx ? realH / heightPx : null;
  const cm = pxv => (mPerPx ? pxv * mPerPx * 100 : NaN);

  const c = contactI;

  // plant offset: strike point (kicking ankle ≈ ball) ahead of plant foot, along shot direction
  const plantOffsetCm = cm((P(c, K.ank).x - P(c, K.pAnk).x) * dir);

  // knee over ball: shank angle from vertical at contact, positive = knee ahead
  const kneeOverBallDeg = signedLean(P(c, K.ank), P(c, K.knee), dir);

  // trunk lean at contact, positive = chest toward target
  const shC = mid(P(c, L.lShoulder), P(c, L.rShoulder));
  const hipC = mid(P(c, L.lHip), P(c, L.rHip));
  const trunkLeanDeg = signedLean(hipC, shC, dir);

  // backswing knee flexion (0 = straight leg)
  const backswingFlexDeg = Number.isFinite(ph.minKneeInterior) ? 180 - ph.minKneeInterior : NaN;

  // knee extension at impact (dot-product interior angle; higher = straighter/snappier)
  const kneeExtensionDeg = angleAt(P(c, K.hip), P(c, K.knee), P(c, K.ank));

  // follow-through: peak thigh swing after contact
  const followThroughDeg = angleFromDown(P(followI, K.hip), P(followI, K.knee));

  // follow-through height: how high the boot finishes above the contact point
  let toeMinY = P(c, K.toe).y;
  for (let i = c; i <= Math.min(FR.length - 1, followI + 2); i++) toeMinY = Math.min(toeMinY, P(i, K.toe).y);
  const followHeightCm = cm(P(c, K.toe).y - toeMinY);

  // ankle: foot-shank alignment at contact (instep wants pointed) + wobble around it
  const anklePointDeg = angleAt(P(c, K.knee), P(c, K.ank), P(c, K.toe));
  const wobbleWin = [];
  for (let i = Math.max(0, c - 2); i <= Math.min(FR.length - 1, c + 2); i++) {
    wobbleWin.push(angleAt(P(i, K.knee), P(i, K.ank), P(i, K.toe)));
  }
  const ankleStabilityDeg = sd(wobbleWin);

  // head steadiness, plant → contact
  const headMoveCm = cm(dist(P(plantI, L.nose), P(c, L.nose)));

  // opposite arm out for balance at contact
  const armBalanceDeg = angleFromDown(P(c, K.oppSh), P(c, K.oppWr));

  const gapMs = FR.length > 1 ? ((FR[FR.length - 1].t - FR[0].t) / (FR.length - 1)) * 1000 : NaN;

  return {
    shotType: typeId,
    strikingFoot: foot,
    view: 'side',
    plantOffsetCm: r1(plantOffsetCm),
    kneeOverBallDeg: r1(kneeOverBallDeg),
    kneeExtensionDeg: r1(kneeExtensionDeg),
    trunkLeanDeg: r1(trunkLeanDeg),
    backswingFlexDeg: r1(backswingFlexDeg),
    followThroughDeg: r1(followThroughDeg),
    followHeightCm: r1(followHeightCm),
    anklePointDeg: r1(anklePointDeg),
    ankleStabilityDeg: r1(ankleStabilityDeg),
    headMoveCm: r1(headMoveCm),
    armBalanceDeg: r1(armBalanceDeg),
    heightUsedM: realH ? +realH.toFixed(2) : null,
    frameGapMs: r1(gapMs),
    strikeSharpFrames: ph.strikeSharpFrames,
    contactApprox: ph.strikeSharpFrames < 3,
    phaseTimes: { plant: +FR[plantI].t.toFixed(3), contact: +FR[c].t.toFixed(3), follow: +FR[followI].t.toFixed(3) },
    scaleNote: mPerPx ? null : 'Add your height in Profile to get plant offset and head movement in centimetres.',
  };
}

/* ---------------- behind (frontal-plane) metrics ----------------
   Approximate from a single 2D view — the right angle for hip rotation
   and approach path, which the side profile can't see. Labelled approx. */
function computeShotMetricsBehind(track, ph, typeId, foot, profile) {
  const { FR, contactI, plantI, followI, torsoPx } = ph;
  const K = kickIdx(foot);
  const P = (i, idx) => px(FR[i].lm[idx], track);
  const realH = parseHeightMeters(profile?.height);
  const mPerPx = realH && torsoPx ? realH / (torsoPx / 0.288) : null;
  const cm = pxv => (mPerPx ? pxv * mPerPx * 100 : NaN);

  // hip rotation: range of the pelvis-line angle through the strike
  const hipLineAng = i => {
    const l = P(i, L.lHip), r = P(i, L.rHip);
    return Math.atan2(r.y - l.y, r.x - l.x) * 180 / Math.PI;
  };
  const angs = [];
  for (let i = plantI; i <= Math.min(FR.length - 1, followI); i++) angs.push(hipLineAng(i));
  const hipRotationDeg = angs.length ? (pct(angs, 92) - pct(angs, 8)) : NaN;

  // chest tilt: lateral lean of the trunk at contact (frontal plane)
  const shC = mid(P(contactI, L.lShoulder), P(contactI, L.rShoulder));
  const hipC = mid(P(contactI, L.lHip), P(contactI, L.rHip));
  const chestSquareDeg = Math.abs(Math.atan2(shC.x - hipC.x, -(shC.y - hipC.y)) * 180 / Math.PI);

  // plant beside ball: lateral gap between plant foot and strike point at contact
  const plantLateralCm = Math.abs(cm(P(contactI, K.ank).x - P(contactI, K.pAnk).x));

  // approach angle: run-up direction in the image, off straight-down-the-lane
  const start = mid(P(0, L.lHip), P(0, L.rHip));
  const dx = hipC.x - start.x, dy = hipC.y - start.y;
  const approachAngleDeg = (Math.abs(dx) + Math.abs(dy) < torsoPx * 0.2) ? NaN
    : Math.abs(Math.atan2(dx, Math.abs(dy) || 1e-3) * 180 / Math.PI);

  // follow direction: how far the kicking leg swings across after contact
  const aC = P(contactI, K.ank), aF = P(followI, K.ank);
  const followSwingDeg = Math.abs(Math.atan2(aF.x - aC.x, -(aF.y - aC.y)) * 180 / Math.PI);

  const headMoveCm = cm(dist(P(plantI, L.nose), P(contactI, L.nose)));
  const gapMs = FR.length > 1 ? ((FR[FR.length - 1].t - FR[0].t) / (FR.length - 1)) * 1000 : NaN;

  return {
    shotType: typeId, strikingFoot: foot, view: 'behind',
    hipRotationDeg: r1(hipRotationDeg),
    chestSquareDeg: r1(chestSquareDeg),
    plantLateralCm: r1(plantLateralCm),
    approachAngleDeg: r1(approachAngleDeg),
    followSwingDeg: r1(followSwingDeg),
    headMoveCm: r1(headMoveCm),
    heightUsedM: realH ? +realH.toFixed(2) : null,
    frameGapMs: r1(gapMs),
    strikeSharpFrames: ph.strikeSharpFrames,
    contactApprox: ph.strikeSharpFrames < 3,
    phaseTimes: { plant: +FR[plantI].t.toFixed(3), contact: +FR[contactI].t.toFixed(3), follow: +FR[followI].t.toFixed(3) },
    scaleNote: mPerPx ? null : 'Add your height in Profile to get the centimetre values.',
    approxNote: 'Behind-view lateral metrics are approximate from a single 2D camera.',
  };
}

function evaluateShot(m, typeId, view = 'side') {
  const set = view === 'behind' ? SHOT_TYPES[typeId].gaugesBehind : SHOT_TYPES[typeId].gauges;
  const g = [];
  for (const [key, label, unit, band, scale, hint] of set) {
    const value = m[key];
    if (value === null || value === undefined) continue;
    const [lo, hi] = band, [min, max] = scale;
    const status = value < lo ? 'low' : value > hi ? 'high' : 'in';
    g.push({ label, value, unit, lo, hi, min, max, status, hint });
  }
  return g;
}

/* ---------------- coach prompt ---------------- */
function shotSystemPrompt(view = 'side') {
  return `You are "Night Match", an elite striking coach analysing ONE athlete's single shot.
${typeof profileSummary === 'function' ? profileSummary() : ''}

You are given objective body-mechanics measurements extracted from ${view === 'behind' ? 'a DIRECTLY-BEHIND (frontal-plane)' : 'a SIDE-ON'} slow-motion video by a pose-tracking model. The ball itself was not tracked — never claim to know where the shot went, its speed, or whether it scored.
${view === 'behind'
  ? 'This is the behind view — coach hip rotation, approach path, plant placement and follow direction. These lateral metrics are approximate from one 2D camera; hedge. Do not comment on knee-over-ball or plant fore/aft distance (that needs the side view).'
  : 'This is the side view — the reference angle for plant distance, knee, chest lean and follow-through.'}

RULES
- Base every claim on the measurements provided. If a metric is null, it was not measurable — do not comment on it.
- Values marked approximate are approximate; hedge accordingly.
- Rank fixes by how much they would improve THIS athlete's strike, given their age, level and position.
- Be specific and physical: "lock the ankle and point the toe down" not "improve technique".
- Sharp, direct, encouraging. No filler. Age-appropriate and safe.

Return ONLY valid JSON, no markdown, exactly this shape:
{
  "headline": "one punchy sentence summarising the strike",
  "strengths": ["1-3 short specific things the data shows they do well"],
  "fixes": [
    { "rank": 1, "title": "short imperative fix, max 6 words", "impact": "high" | "medium" | "low",
      "observed": "the measurement that shows this, quoted with its number",
      "why": "one sentence on what it costs the strike",
      "drill": "one concrete drill with sets/reps or time" }
  ],
  "coachNote": "2-3 sentences of direct coaching tying it to their goals and position"
}
Give exactly 3 fixes, ranked 1-3 by impact.`;
}

function shotBrief(m, weakFoot, view = 'side') {
  const t = SHOT_TYPES[m.shotType];
  const set = view === 'behind' ? t.gaugesBehind : t.gauges;
  const lines = [
    `Shot type: ${t.name} (${t.range}) · view: ${view === 'behind' ? 'directly behind' : 'side-on'}`,
    `Striking foot: ${m.strikingFoot === 'L' ? 'Left' : 'Right'}${weakFoot ? ' — THIS IS THEIR WEAK FOOT. Judge against realistic weak-foot standards, credit what already works, and bias drills toward weak-foot repetitions.' : ''}`,
    m.contactApprox ? 'NOTE: contact timing is approximate (few frames covered the strike).' : 'Contact frame was sharply resolved.',
    m.approxNote ? 'NOTE: ' + m.approxNote : '',
    '',
    `MEASURED (${view === 'behind' ? 'behind, approximate' : 'side-on'}):`,
  ].filter(Boolean);
  for (const [key, label, unit, band] of set) {
    const v = m[key];
    lines.push(`- ${label}: ${v === null || v === undefined ? 'not measurable' : v + ' ' + unit} (target ${band[0]}–${band[1]} ${unit})`);
  }
  if (m.scaleNote) lines.push(`- NOTE: ${m.scaleNote}`);
  lines.push('', `Coaching priorities for a ${t.name.toLowerCase()}: ${t.focus.join('; ')}.`);
  return lines.join('\n');
}

/* ---------------- frame stills ---------------- */
async function frameGrabber(file, width = 880) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url; video.muted = true; video.playsInline = true; video.preload = 'auto';
  await new Promise((res, rej) => {
    video.onloadedmetadata = () => res();
    video.onerror = () => rej(new Error('Could not reopen the clip for stills.'));
    setTimeout(() => rej(new Error('Timed out reopening the clip.')), 15000);
  });
  const scale = Math.min(1, width / video.videoWidth);
  const w = Math.round(video.videoWidth * scale), h = Math.round(video.videoHeight * scale);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  return {
    async grab(t, lm, foot) {
      await seekTo(video, t);
      ctx.drawImage(video, 0, 0, w, h);
      if (lm) drawPoseOnCanvas(ctx, lm, w, h, foot);
      return canvas.toDataURL('image/jpeg', 0.85);
    },
    close() { URL.revokeObjectURL(url); video.src = ''; },
  };
}

/* kicking leg in flare, plant leg in the gait strip's cyan, rest chalk */
function drawPoseOnCanvas(ctx, lm, w, h, foot) {
  const X = p => p.x * w, Y = p => p.y * h;
  const kickLeg = foot === 'L' ? [[23, 25], [25, 27], [27, 31]] : [[24, 26], [26, 28], [28, 32]];
  const plantLeg = foot === 'L' ? [[24, 26], [26, 28], [28, 32]] : [[23, 25], [25, 27], [27, 31]];
  const key = b => b[0] + '-' + b[1];
  const special = new Map([
    ...kickLeg.map(b => [key(b), '#ff4d2e']),
    ...plantLeg.map(b => [key(b), '#7fd2ff']),
  ]);
  ctx.lineCap = 'round';
  for (const bone of BONES) {
    const p = lm[bone[0]], q = lm[bone[1]];
    if (!p || !q || (p.visibility ?? 1) < 0.4 || (q.visibility ?? 1) < 0.4) continue;
    const col = special.get(key(bone));
    ctx.strokeStyle = col || 'rgba(236,239,233,.85)';
    ctx.lineWidth = col ? 4 : 2;
    ctx.shadowColor = col || 'transparent'; ctx.shadowBlur = col ? 8 : 0;
    ctx.beginPath(); ctx.moveTo(X(p), Y(p)); ctx.lineTo(X(q), Y(q)); ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

/* =====================================================================
   SHOOTING VIEW — controller
   ===================================================================== */
const sh = { type: 'instep', view: 'side', foot: 'R', setting: 'goal', busy: false, cancelled: false };

function initShoot() {
  const p = store.get('profile');
  sh.foot = p?.foot === 'Left' ? 'L' : 'R';
  sh.view = SHOT_TYPES[sh.type].view;

  renderShotTypes();
  renderViewSeg();
  renderShotGuide();
  renderFootSeg();

  $('#shTypes').addEventListener('click', e => {
    const card = e.target.closest('[data-type]'); if (!card) return;
    sh.type = card.dataset.type;
    sh.view = SHOT_TYPES[sh.type].view;   // default to the angle this shot reads best from
    renderShotTypes(); renderViewSeg(); renderShotGuide();
  });

  const viewSeg = $('.sh-view-seg');
  if (viewSeg) viewSeg.addEventListener('click', e => {
    const b = e.target.closest('.seg-btn'); if (!b) return;
    sh.view = b.dataset.view; renderViewSeg(); renderShotGuide();
  });

  $('.sh-foot-seg').addEventListener('click', e => {
    const b = e.target.closest('.seg-btn'); if (!b) return;
    sh.foot = b.dataset.val; renderFootSeg();
  });

  $('.sh-set-seg').addEventListener('click', e => {
    const b = e.target.closest('.seg-btn'); if (!b) return;
    $$('.seg-btn', $('.sh-set-seg')).forEach(x => x.classList.remove('on'));
    b.classList.add('on'); sh.setting = b.dataset.val; renderShotGuide();
  });

  const drop = $('#shDrop'), input = $('#shFile');
  input.addEventListener('change', () => { if (input.files[0]) startShootAnalysis(input.files[0]); });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => {
    const f = e.dataTransfer?.files?.[0];
    if (f) { if (/^video\//.test(f.type)) startShootAnalysis(f); else toast('That file is not a video', false); }
  });

  $('#shCancel').addEventListener('click', () => { sh.cancelled = true; resetShoot(); });
}

function renderShotTypes() {
  $('#shTypes').innerHTML = Object.values(SHOT_TYPES).map(t => `
    <button type="button" class="az-type ${t.id === sh.type ? 'on' : ''}" data-type="${t.id}">
      <span class="az-type-name">${t.name}</span>
      <span class="az-type-range">${t.range}</span>
      <span class="az-type-blurb">${esc(t.blurb)}</span>
    </button>`).join('');
}

function renderViewSeg() {
  const seg = $('.sh-view-seg'); if (!seg) return;
  $$('.seg-btn', seg).forEach(b => b.classList.toggle('on', b.dataset.view === sh.view));
  const rec = $('#shViewRec');
  if (rec) rec.textContent = `Recommended for a ${SHOT_TYPES[sh.type].name.toLowerCase()}: ${SHOT_TYPES[sh.type].view === 'behind' ? 'directly behind' : 'side profile'}.`;
}

function renderFootSeg() {
  $$('.seg-btn', $('.sh-foot-seg')).forEach(b => b.classList.toggle('on', b.dataset.val === sh.foot));
  const p = store.get('profile');
  const dominant = p?.foot === 'Left' ? 'L' : p?.foot === 'Right' ? 'R' : null;
  const weak = dominant && sh.foot !== dominant;
  const note = $('#shWeakNote');
  note.classList.toggle('hidden', !weak);
}

function isWeakFootSession() {
  const p = store.get('profile');
  const dominant = p?.foot === 'Left' ? 'L' : p?.foot === 'Right' ? 'R' : null;
  return !!dominant && sh.foot !== dominant;
}

function renderShotGuide() {
  const s = SHOT_SETTINGS[sh.setting], fr = SHOOT_FRAMING[sh.view];
  $('#shGuide').innerHTML = `
    <div class="az-guide-lead">${esc(fr.lead)}</div>
    <ol class="az-guide-list">${fr.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
    <div class="sh-slomo">
      <span class="sh-slomo-tag">Slo-mo required</span>
      <span>${esc(SLOMO_RULE)}</span>
    </div>
    <div class="az-guide-tips">
      <div class="az-guide-tips-h">${esc(s.name)}</div>
      <ul><li>${esc(s.note)}</li><li>One strike per clip, under ~8 seconds.</li></ul>
    </div>`;
}

function shStatus(msg, frac, phase) {
  const s = $('#shStatus'); if (s) s.textContent = msg;
  if (typeof frac === 'number') { const b = $('#shBar'); if (b) b.style.width = Math.round(frac * 100) + '%'; }
  if (typeof phase === 'number') {
    $$('#shPhases li').forEach(li => {
      const p = +li.dataset.phase;
      li.classList.toggle('on', p === phase);
      li.classList.toggle('done', p < phase);
    });
  }
}

function resetShoot() {
  sh.busy = false;
  $('#shWorking').classList.add('hidden');
  $('#shResult').classList.add('hidden');
  $('#shSetup').classList.remove('hidden');
  $('#shFile').value = '';
  $('#shBar').style.width = '0%';
}

function shError(msg) {
  const el = $('#shResult');
  el.classList.remove('hidden');
  el.innerHTML = `<div class="ans-quick" style="border-color:rgba(255,122,107,.4)">${WARN}${esc(msg)}</div>
    <button class="btn btn-ghost sh-again">Try another clip</button>`;
  $('.sh-again', el).addEventListener('click', resetShoot);
}

function shBlocked(issues) {
  const el = $('#shResult');
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="az-blocked">
      <div class="az-blocked-h">${WARN} This clip can't be analysed accurately</div>
      <p class="az-blocked-sub">Rather than coach you off bad data, here's exactly what to change:</p>
      <ul class="az-issues">
        ${issues.map(i => `<li><b>${esc(i.title)}</b><span>${esc(i.fix)}</span></li>`).join('')}
      </ul>
      <button class="btn btn-accent sh-again">Film it again</button>
    </div>`;
  $('.sh-again', el).addEventListener('click', resetShoot);
}

async function startShootAnalysis(file) {
  if (sh.busy) return;
  if (!canCoach()) { openSettings(); toast('Add your API key to analyse clips', false); return; }
  if (!/^video\//.test(file.type)) { toast('That file is not a video', false); return; }

  sh.busy = true; sh.cancelled = false;
  $('#shSetup').classList.add('hidden');
  $('#shResult').classList.add('hidden');
  $('#shWorking').classList.remove('hidden');
  $$('#shPhases li').forEach(li => li.classList.remove('on', 'done'));
  shStatus('Checking frame rate…', 0.02, 0);

  let grabber = null;
  try {
    // slo-mo gate first — reject clearly-non-slo-mo before heavy work
    const fps = await estimateSourceFps(file);
    if (sh.cancelled) return;
    if (fps !== null && fps < 85) {
      shBlocked([{ title: 'This clip isn’t slow-motion', fix: `Film every shot in slo-mo at 120fps or higher (this looks like ~${Math.round(fps)}fps). Contact lasts ~10ms and blurs between frames at normal speed.` }]);
      return;
    }

    // pass 1: coarse scan of the whole clip
    shStatus('Reading your clip…', 0.08, 0);
    const coarse = await extractPose(file, (msg, frac) => shStatus(msg, 0.08 + (frac ?? 0) * 0.45, frac && frac > 0.07 ? 1 : 0));
    if (sh.cancelled) return;

    const quality = gradeCapture(coarse);
    const issues = quality.ok ? [] : [...quality.issues];

    // close-up gate — the body + ball must fill the frame (5–8 ft)
    if (Number.isFinite(quality.medSize) && quality.medSize < 0.42) {
      issues.push({ title: 'Move the camera closer', fix: 'Film 5–8 ft (1.5–2.5 m) away so your body and the ball fill the frame — from far back the fine angles can’t be read.' });
    }

    // camera angle must match the chosen view
    const det = sideOnCheck(coarse);
    const wantSide = sh.view === 'side';
    if (wantSide && !det.sideOn) issues.push({ title: 'This clip is not side-on', fix: 'Set the camera square to your side (a true 90° profile) — front-on angles hide the plant, knee and lean.' });
    if (!wantSide && det.sideOn) issues.push({ title: 'This clip is not from behind', fix: 'Set the camera directly behind you, looking straight down your shooting line — the side profile can’t read hip rotation or approach path.' });

    const strike = findStrike(coarse, sh.foot);
    if (!strike.ok) issues.push({ title: 'No clear strike detected', fix: `Make sure your ${sh.foot === 'L' ? 'left' : 'right'} foot actually strikes in this clip, your legs are visible throughout, and there is one single shot in the recording.` });
    if (issues.length) { shBlocked(issues); return; }

    // pass 2: dense scan around the strike
    shStatus('Zeroing in on the strike…', 0.58, 2);
    const refined = await extractPose(file, (msg, frac) => {
      const f = Math.max(0, Math.min(1, ((frac ?? 0.08) - 0.08) / 0.72));
      shStatus('Zeroing in on the strike…', 0.58 + f * 0.22, 2);
    }, { startTime: Math.max(0, strike.tc - 0.7), endTime: strike.tc + 0.9, fps: 90 });
    if (sh.cancelled) return;

    const phases = detectShotPhases(refined, sh.foot);
    if (!phases) { shBlocked([{ title: 'Not enough of the strike was tracked', fix: 'Film closer, in brighter light, and keep your whole body in frame through the kick.' }]); return; }

    const cFrame = phases.FR[phases.contactI].lm;
    if (vis(cFrame, kickIdx(sh.foot).ank) < 0.5 || vis(cFrame, kickIdx(sh.foot).pAnk) < 0.5) {
      shBlocked([{ title: 'Feet not visible at the strike', fix: 'Both feet must be clearly in frame at the moment of contact — reframe so nothing below the knee gets cut off.' }]);
      return;
    }

    // contact confirm step
    grabber = await frameGrabber(file);
    await showContactConfirm(file, refined, phases, grabber);
  } catch (e) {
    if (!sh.cancelled) shError(e.message);
  } finally {
    sh.busy = false;
    $('#shWorking').classList.add('hidden');
    if (grabber && !$('#shResult .sh-confirm')) grabber.close();
  }
}

/* the one detection error that skews everything downstream is a wrong
   contact frame — so the athlete gets to nudge it before we measure */
async function showContactConfirm(file, refined, phases, grabber) {
  const el = $('#shResult');
  const { FR, contactI } = phases;
  const span = 5;
  const lo = Math.max(0, contactI - span), hi = Math.min(FR.length - 1, contactI + span);

  shStatus('Preparing the strike frames…', 0.85, 2);
  const imgs = {};
  for (let i = lo; i <= hi; i++) imgs[i] = await grabber.grab(FR[i].t, FR[i].lm, sh.foot);
  if (sh.cancelled) { grabber.close(); return; }

  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="sh-confirm glass">
      <div class="az-sec-h">${SVG.target}<span>Check the contact frame</span></div>
      <p class="sh-confirm-sub">This should be the exact moment your boot meets the ball. If it's a touch early or late, nudge it — every angle is measured off this frame.</p>
      <div class="sh-confirm-frame"><img id="shConfirmImg" src="${imgs[contactI]}" alt="Detected contact frame" /></div>
      <div class="sh-scrub">
        <span class="sh-scrub-l">Earlier</span>
        <input type="range" id="shScrub" min="${lo}" max="${hi}" step="1" value="${contactI}" aria-label="Nudge contact frame" />
        <span class="sh-scrub-l">Later</span>
      </div>
      <div id="shScrubInfo" class="sh-scrub-info">Detected contact</div>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn btn-ghost sh-c-cancel">Cancel</button>
        <button class="btn btn-accent sh-c-ok">Looks right — measure it</button>
      </div>
    </div>`;

  const scrub = $('#shScrub', el);
  scrub.addEventListener('input', () => {
    const i = +scrub.value;
    $('#shConfirmImg', el).src = imgs[i];
    const off = i - contactI;
    $('#shScrubInfo', el).textContent = off === 0 ? 'Detected contact' : `${off > 0 ? '+' : ''}${off} frame${Math.abs(off) > 1 ? 's' : ''} (${((FR[i].t - FR[contactI].t) * 1000).toFixed(0)}ms)`;
  });

  $('.sh-c-cancel', el).addEventListener('click', () => { grabber.close(); resetShoot(); });
  $('.sh-c-ok', el).addEventListener('click', async () => {
    el.classList.add('hidden');
    $('#shWorking').classList.remove('hidden');
    sh.busy = true;
    try {
      const chosen = +scrub.value;
      const ph = detectShotPhases(refined, sh.foot, chosen);
      shStatus('Measuring your strike…', 0.88, 2);
      const profile = store.get('profile');
      const behind = sh.view === 'behind';
      const metrics = behind
        ? computeShotMetricsBehind(refined, ph, sh.type, sh.foot, profile)
        : computeShotMetrics(refined, ph, sh.type, sh.foot, profile);

      // signature stills at the three phase frames
      const cap = behind ? {
        plant: 'Plant & set', contact: metrics.hipRotationDeg !== null ? `Hips ${metrics.hipRotationDeg}°` : 'Contact',
        follow: metrics.followSwingDeg !== null ? `Swing ${metrics.followSwingDeg}°` : 'Follow-through',
      } : {
        plant: metrics.backswingFlexDeg !== null ? `Knee bend ${metrics.backswingFlexDeg}°` : 'Plant foot down',
        contact: [metrics.kneeOverBallDeg !== null ? `Knee ${metrics.kneeOverBallDeg}° over` : null,
                  metrics.plantOffsetCm !== null ? `plant ${metrics.plantOffsetCm}cm` : null].filter(Boolean).join(' · ') || 'The strike',
        follow: metrics.followThroughDeg !== null ? `Swing to ${metrics.followThroughDeg}°` : 'Swing through',
      };
      const stills = [];
      for (const [phase, idx, caption] of [['Plant', ph.plantI, cap.plant], ['Contact', ph.contactI, cap.contact], ['Follow-through', ph.followI, cap.follow]]) {
        stills.push({ phase, caption, img: await grabber.grab(ph.FR[idx].t, ph.FR[idx].lm, sh.foot) });
      }
      grabber.close();

      shStatus('Coach is reading your strike…', 0.94, 3);
      const { text } = await callGemini(shotSystemPrompt(sh.view), shotBrief(metrics, isWeakFootSession(), sh.view), false, true);
      let report;
      try { report = JSON.parse(cleanJSON(text)); }
      catch { throw new Error('The coach returned an unreadable report. Try again.'); }

      renderShotReport({ metrics, report, track: refined, stills }, file);
    } catch (e) {
      grabber.close();
      shError(e.message);
    } finally {
      sh.busy = false;
      $('#shWorking').classList.add('hidden');
    }
  });
}

/* ---------------- report ---------------- */
function renderShotReport(out, file) {
  const { metrics: m, report: r, stills } = out;
  const t = SHOT_TYPES[m.shotType];
  const el = $('#shResult');
  el.classList.remove('hidden');

  const impactClass = i => ({ high: 'hi', medium: 'md', low: 'lo' }[String(i || '').toLowerCase()] || 'md');
  const behind = m.view === 'behind';
  const gauges = evaluateShot(m, m.shotType, m.view);
  const footLabel = m.strikingFoot === 'L' ? 'Left foot' : 'Right foot';
  const weak = isWeakFootSession();

  el.innerHTML = `
    <div class="az-report">
      <header class="az-headline">
        <span class="az-tag">${esc(t.name)} · ${behind ? 'behind' : 'side'} · ${footLabel}${weak ? ' · weak foot' : ''}</span>
        <h2>${esc(r.headline || 'Your strike, measured.')}</h2>
      </header>

      ${stills?.length ? `<div class="sh-seq">
        ${stills.map(s => `
          <figure class="sh-still">
            <img src="${s.img}" alt="${esc(s.phase)} frame with skeleton overlay" />
            <figcaption><span class="sh-still-tag">${esc(s.phase)}</span><span class="sh-still-cap">${esc(s.caption)}</span></figcaption>
          </figure>`).join('')}
      </div>` : ''}

      ${m.contactApprox ? `<p class="az-note sh-approx-note">Contact timing is approximate — few frames covered the strike. Film in slo-mo next time for a sharper read.</p>` : ''}

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
          ${r.coachNote ? `<div class="ans-quick">${esc(r.coachNote)}</div>` : ''}
        </div>

        <aside class="az-col-side">
          ${r.strengths?.length ? `<div class="az-strengths">
            <div class="az-sec-h az-sec-h--good">${SVG.target}<span>Working well</span></div>
            <ul class="az-str-list">${r.strengths.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
          </div>` : ''}

          <div class="az-gauges">
            <div class="az-sec-h"><span>Measured</span><em>${behind ? 'behind · approx' : 'vs ' + esc(t.name.toLowerCase())} target</em></div>
            ${gauges.map(gaugeHTML).join('')}
          </div>

          <div class="az-media">
            <div class="az-video-wrap">
              <video id="shVideo" class="az-video" playsinline controls loop></video>
              <canvas id="shSkeleton" class="az-skeleton hidden"></canvas>
            </div>
            <label class="az-toggle" for="shSkelToggle">
              <input type="checkbox" id="shSkelToggle" class="switch" />
              <span>Show tracking skeleton</span>
            </label>
          </div>

          <p class="az-note">${m.scaleNote ? esc(m.scaleNote) + ' ' : ''}${behind
            ? 'Behind-view lateral metrics (hip rotation, approach, follow direction) are approximate from a single 2D camera. The ball is not tracked — this reads your body, not the shot’s result.'
            : 'Angles are measured from side-on pose tracking; centimetre values are scaled from your height. The ball is not tracked — this reads your body, not the shot’s result.'}</p>
        </aside>
      </div>

      <div class="ans-actions">
        <button class="icon-btn sh-save"><svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>Save</button>
        <button class="icon-btn sh-again"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.36 2.64L3 8"/><path d="M3 3v5h5"/></svg>Analyse another</button>
      </div>
    </div>`;

  const video = $('#shVideo', el);
  video.src = URL.createObjectURL(file);
  const canvas = $('#shSkeleton', el);
  const toggle = $('#shSkelToggle', el);
  toggle.addEventListener('change', () => {
    canvas.classList.toggle('hidden', !toggle.checked);
    if (toggle.checked) drawSkeletonLoop(video, canvas, out.track);
  });

  $('.sh-again', el).addEventListener('click', resetShoot);
  $('.sh-save', el).addEventListener('click', e => {
    const saved = store.get('saved', []);
    saved.unshift({
      id: uid(), ts: Date.now(), type: 'analysis',
      question: `${t.name} — ${r.headline || 'strike analysis'}`.trim(),
      analysis: { metrics: m, report: r },
    });
    store.set('saved', saved);
    e.currentTarget.classList.add('saved');
    e.currentTarget.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>Saved`;
    toast('Analysis saved');
  });
}
