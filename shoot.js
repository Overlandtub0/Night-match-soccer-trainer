/* ============================================================
   NIGHT MATCH — Shooting Analyzer
   Side-on strike → plant / contact / follow-through phases →
   body-mechanics metrics → ranked fixes. No ball tracking:
   at contact your foot IS at the ball, so plant offset comes
   free from pose alone. Video never leaves the device.
   Depends on analyze.js (pose model, geometry, gauges).
   ============================================================ */

/* ---------------- the shot ----------------
   One generic strike — no shot types. Shoot however you like (drive,
   side-foot, curl, chip, volley); the coach reads what your body actually
   does rather than judging you against a preset. Always filmed side-on, so
   there is a single side-profile gauge set. Each gauge:
   [key, label, unit, targetBand, scale, hint]. Bands describe sound striking
   fundamentals common to most shots — generous on purpose, since a placement
   finish and a power drive are both legitimate. */

function sideGauges(over = {}) {
  const g = {
    plantOffsetCm: ['Plant offset', 'cm', [-5, 25], [-25, 55], 'Plant foot level with the ball, not behind it'],
    kneeOverBallDeg: ['Knee over ball', '°', [0, 30], [-25, 50], 'Knee ahead of the ankle keeps it down'],
    kneeExtensionDeg: ['Knee extension', '°', [110, 178], [70, 190], 'Extend the knee through impact'],
    trunkLeanDeg: ['Trunk lean', '°', [-5, 28], [-30, 50], 'Chest over the ball, not thrown back'],
    backswingFlexDeg: ['Backswing knee bend', '°', [45, 125], [10, 155], 'Your power reservoir'],
    followThroughDeg: ['Follow-through', '°', [25, 95], [0, 115], 'Swing through the ball, not at it'],
    followHeightCm: ['Follow-through height', 'cm', [10, 100], [0, 150], 'Height the boot finishes at'],
    anklePointDeg: ['Ankle locked', '°', [140, 190], [90, 200], 'Firm ankle — locked through contact'],
    ankleStabilityDeg: ['Ankle wobble', '°', [0, 9], [0, 25], 'Lower means locked'],
    headMoveCm: ['Head movement', 'cm', [0, 14], [0, 30], 'Still head, clean strike'],
    armBalanceDeg: ['Balance arm', '°', [10, 65], [0, 90], 'Opposite arm out to counter-balance'],
  };
  Object.assign(g, over);
  return Object.entries(g).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, ...v]);
}

// the single, type-agnostic shot everything now runs on
const SHOT = {
  id: 'shot', name: 'Your shot',
  focus: [
    'Plant foot level with and beside the ball',
    'Knee over the ball to keep it down',
    'Locked, firm ankle through contact',
    'Balanced body with a committed follow-through',
  ],
  gauges: sideGauges(),
};

// where you're shooting — short environment context (camera specifics live in SHOOT_FRAMING)
const SHOT_SETTINGS = {
  goal:  { id: 'goal',  name: 'Full goal',        note: 'Ball 12–20 yards out, dead centre. Net catches the ball so you can shoot freely.' },
  wall:  { id: 'wall',  name: 'Wall / rebounder', note: 'Tighter space — the ball comes back, so give yourself room and expect a rebound.' },
  field: { id: 'field', name: 'Open field',       note: 'Use a clean, uncluttered background — no one walking behind you.' },
};

// camera rules — side profile ONLY, close-up enforced.
// Note we deliberately do NOT ask for a long run-up: only the final approach
// step, the plant and the strike need to be in frame. The jog toward the ball
// is neither needed nor analysed.
const SHOOT_FRAMING = {
  side: {
    lead: 'Side profile only — the camera must look straight at your side (a true 90° angle). This is the one angle that can read your plant, knee, chest lean and follow-through.',
    steps: [
      'Phone square to your shooting line, at a true 90° side angle, lens at hip height.',
      'Close up: 5–8 ft (1.5–2.5 m) from the ball so your body and the ball fill the frame.',
      'Only your last approach step needs to be in shot — a long run-up isn’t needed or analysed. Keep your whole body in frame on a dead-still tripod.',
    ],
  },
};
const SLOMO_RULE = 'Slow motion is strongly recommended (120fps+ if your phone has it). Ball contact lasts about 10ms, so the faster you film, the sharper the read — but any clip will still be analysed, and it’ll tell you if the strike was under-sampled.';

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

function evaluateShot(m) {
  const set = SHOT.gauges;
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
function shotSystemPrompt() {
  return `You are "Night Match", an elite striking coach analysing ONE athlete's single shot.
${typeof profileSummary === 'function' ? profileSummary() : ''}

You are given objective body-mechanics measurements extracted from a SIDE-ON slow-motion video by a pose-tracking model, covering the final approach step, plant, contact and follow-through. The ball itself was not tracked — never claim to know where the shot went, its speed, or whether it scored.
This is the side view — the reference angle for plant distance, knee, chest lean and follow-through. You do NOT know the athlete's intended shot type (drive, side-foot, curl, chip, volley), so coach the fundamentals the measurements reveal rather than assuming a shot type; if the numbers clearly suggest one intent, you may say so tentatively.

RULES
- Base every claim on the measurements provided. If a metric is null, it was not measurable — do not comment on it.
- The target bands describe general sound-striking fundamentals, not one shot type — a value slightly outside a band can still be correct for a placement finish or a deliberate chip. Weigh that before calling it a fault.
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

function shotBrief(m, weakFoot) {
  const set = SHOT.gauges;
  const lines = [
    `Shot: a single side-on strike (shot type not specified — read the body, not a preset).`,
    `Striking foot: ${m.strikingFoot === 'L' ? 'Left' : 'Right'}${weakFoot ? ' — THIS IS THEIR WEAK FOOT. Judge against realistic weak-foot standards, credit what already works, and bias drills toward weak-foot repetitions.' : ''}`,
    m.contactApprox ? 'NOTE: contact timing is approximate (few frames covered the strike — likely not filmed in slow motion).' : 'Contact frame was sharply resolved.',
    '',
    `MEASURED (side-on, final approach → follow-through):`,
  ].filter(Boolean);
  for (const [key, label, unit, band] of set) {
    const v = m[key];
    lines.push(`- ${label}: ${v === null || v === undefined ? 'not measurable' : v + ' ' + unit} (sound-technique range ${band[0]}–${band[1]} ${unit})`);
  }
  if (m.scaleNote) lines.push(`- NOTE: ${m.scaleNote}`);
  lines.push('', `General striking fundamentals to weigh: ${SHOT.focus.join('; ')}.`);
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
// no shot types, no view choice — one generic strike, always side-on
const sh = { type: 'shot', view: 'side', foot: 'R', setting: 'goal', busy: false, cancelled: false };

function initShoot() {
  const p = store.get('profile');
  sh.foot = p?.foot === 'Left' ? 'L' : 'R';

  renderShotGuide();
  renderFootSeg();

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
  const s = SHOT_SETTINGS[sh.setting], fr = SHOOT_FRAMING.side;
  $('#shGuide').innerHTML = `
    <div class="az-guide-lead">${esc(fr.lead)}</div>
    <ol class="az-guide-list">${fr.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
    <div class="sh-slomo">
      <span class="sh-slomo-tag">Slo-mo recommended</span>
      <span>${esc(SLOMO_RULE)}</span>
    </div>
    <div class="az-guide-tips">
      <div class="az-guide-tips-h">${esc(s.name)}</div>
      <ul><li>${esc(s.note)}</li><li>One strike per clip, under ~8 seconds. Shoot however you like — drive, side-foot, curl, chip.</li></ul>
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
  shStatus('Reading your clip…', 0.04, 0);

  let grabber = null;
  try {
    // NOTE: no frame-rate gate. A re-encoded clip (e.g. a phone slo-mo export
    // or a download) plays back at ~30fps regardless of how fast it was
    // captured, so the file's fps tells us nothing about whether the strike is
    // well-sampled — the old estimator wrongly rejected genuine slo-mo clips.
    // We analyse whatever we're given and, if the contact was under-sampled,
    // flag it as approximate (contactApprox) rather than refusing the clip.

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

    // camera angle: side profile is required
    const det = sideOnCheck(coarse);
    if (!det.sideOn) issues.push({ title: 'This clip is not side-on', fix: 'Every shot must be filmed from a side profile — set the camera square to your side (a true 90° angle). Front-on or angled clips hide the plant, knee and lean.' });

    const strike = findStrike(coarse, sh.foot);
    if (!strike.ok) issues.push({ title: 'No clear strike detected', fix: `Make sure your ${sh.foot === 'L' ? 'left' : 'right'} foot actually strikes in this clip, your legs are visible throughout, and there is one single shot in the recording.` });
    if (issues.length) { shBlocked(issues); return; }

    // pass 2: dense scan around the strike ONLY — just the final approach step,
    // plant, contact and follow-through. We deliberately don't scan the run-up
    // before this window: the jog toward the ball isn't part of the mechanics
    // we measure, so a long run-up neither helps nor is analysed.
    shStatus('Zeroing in on the strike…', 0.58, 2);
    const refined = await extractPose(file, (msg, frac) => {
      const f = Math.max(0, Math.min(1, ((frac ?? 0.08) - 0.08) / 0.72));
      shStatus('Zeroing in on the strike…', 0.58 + f * 0.22, 2);
    }, { startTime: Math.max(0, strike.tc - 0.55), endTime: strike.tc + 0.9, fps: 90 });
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
      const metrics = computeShotMetrics(refined, ph, sh.type, sh.foot, profile);

      // signature stills at the three phase frames
      const cap = {
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
      const { text } = await callGemini(shotSystemPrompt(), shotBrief(metrics, isWeakFootSession()), false, true);
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
  const el = $('#shResult');
  el.classList.remove('hidden');

  const impactClass = i => ({ high: 'hi', medium: 'md', low: 'lo' }[String(i || '').toLowerCase()] || 'md');
  const gauges = evaluateShot(m);
  const footLabel = m.strikingFoot === 'L' ? 'Left foot' : 'Right foot';
  const weak = isWeakFootSession();

  el.innerHTML = `
    <div class="az-report">
      <header class="az-headline">
        <span class="az-tag">${esc(SHOT.name)} · side profile · ${footLabel}${weak ? ' · weak foot' : ''}</span>
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
            <div class="az-sec-h"><span>Measured</span><em>side-on · sound-technique range</em></div>
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

          <p class="az-note">${m.scaleNote ? esc(m.scaleNote) + ' ' : ''}Angles are measured from side-on pose tracking; centimetre values are scaled from your height. The ball is not tracked — this reads your body, not the shot’s result.</p>
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
      question: `${SHOT.name} — ${r.headline || 'strike analysis'}`.trim(),
      analysis: { metrics: m, report: r },
    });
    store.set('saved', saved);
    e.currentTarget.classList.add('saved');
    e.currentTarget.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>Saved`;
    toast('Analysis saved');
  });
}
