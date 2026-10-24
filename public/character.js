// Procedural avatar drawn as SVG.
// muscle 0..1 – how built he is (driven by goal progress over the last weeks)
// energy 0..1 – how fresh he looks (driven by last night's sleep and recent days)

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

function mix(hexA, hexB, t) {
  const a = hexA.match(/\w\w/g).map((h) => parseInt(h, 16));
  const b = hexB.match(/\w\w/g).map((h) => parseInt(h, 16));
  return `${a.map((v, i) => Math.round(lerp(v, b[i], t)).toString(16).padStart(2, '0')).join('')}`;
}

const f = (n) => Math.round(n * 10) / 10;

export function characterState(muscle, energy) {
  if (energy < 0.25) return { label: 'Erschöpft', hint: 'Schlaf nachholen, dann Vollgas.' };
  if (energy < 0.45) return { label: 'Müde', hint: 'Mehr Schlaf, mehr Power.' };
  if (muscle > 0.85 && energy > 0.75) return { label: 'Beast Mode', hint: 'Du überschreitest deine Ziele.' };
  if (muscle > 0.6) return { label: 'Stark', hint: 'Fast alle Ziele auf Kurs.' };
  if (muscle > 0.35) return { label: 'Im Aufbau', hint: 'Bleib dran, es zeigt sich schon.' };
  return { label: 'Starter', hint: 'Jedes erreichte Ziel macht dich breiter.' };
}

export function renderCharacter(muscle, energy) {
  const m = clamp(muscle);
  const e = clamp(energy);
  const tired = 1 - e;
  const cx = 150;

  // Colours: skin turns paler and greyer when exhausted.
  const skin = mix('f1c3a1', 'dcc4b8', tired * 0.8);
  const skinShade = mix('d39a78', 'b8a097', tired * 0.8);
  const skinLine = mix('b0705a', '9a8580', tired * 0.6);
  const hair = '6e4527';
  const hairLight = '9c6b40';

  // Body proportions
  const slouch = tired * 7;
  const shoulderY = 160 + slouch;
  const S = lerp(46, 80, m); // shoulder half-width
  const W = lerp(31, 39, m); // waist half-width
  const H = W + 6; // hip half-width
  const nw = lerp(12, 20, m); // neck half-width
  const ua = lerp(11, 25, m); // upper arm thickness
  const fa = lerp(9, 16, m); // forearm thickness
  const armAngle = lerp(5, 14, m); // lats push the arms out
  const armpitY = shoulderY + 30;
  const waistY = 284;
  const def = clamp((m - 0.2) / 0.6); // muscle definition visibility
  const headDrop = tired * 6;

  // Face
  const lid = clamp(tired * 0.75); // how far the upper eyelids are closed
  const smile = lerp(-3, 11, e); // >0 smiling, <0 frowning
  const browTilt = lerp(4, -2, e); // inner brow raised when tired

  const torso = `
    M ${cx - nw} 138
    C ${cx - nw - 6} ${shoulderY - 10} ${cx - S + 20} ${shoulderY - 8} ${cx - S + 6} ${shoulderY}
    C ${cx - S + 2} ${shoulderY + 10} ${cx - S + 6} ${armpitY - 4} ${cx - S + 12} ${armpitY}
    C ${cx - S + 16} ${armpitY + 40} ${cx - W - 4} ${waistY - 40} ${cx - W} ${waistY}
    L ${cx - W - 1} ${waistY + 14} L ${cx + W + 1} ${waistY + 14} L ${cx + W} ${waistY}
    C ${cx + W + 4} ${waistY - 40} ${cx + S - 16} ${armpitY + 40} ${cx + S - 12} ${armpitY}
    C ${cx + S - 6} ${armpitY - 4} ${cx + S - 2} ${shoulderY + 10} ${cx + S - 6} ${shoulderY}
    C ${cx + S - 20} ${shoulderY - 8} ${cx + nw + 6} ${shoulderY - 10} ${cx + nw} 138 Z`;

  const arm = `
    M ${-ua * 0.95} 0
    C ${-ua * 1.25} 30 ${-ua * 1.05} 72 ${-fa * 0.95} 98
    C ${-fa * 1.2} 120 ${-fa * 0.95} 152 ${-fa * 0.62} 178
    L ${fa * 0.62} 178
    C ${fa * 0.85} 152 ${fa * 1.0} 122 ${fa * 0.78} 98
    C ${ua * 0.85} 76 ${ua * 1.0} 34 ${ua * 0.75} 0 Z`;

  const armGroup = (side) => {
    const x = cx + side * (S - 10);
    return `
    <g class="arm arm-${side < 0 ? 'l' : 'r'}" transform="translate(${f(x)} ${f(shoulderY + 6)}) rotate(${f(-side * armAngle)})">
      <g transform="scale(${side < 0 ? 1 : -1} 1)">
        <path d="${arm}" fill="url(#skinGrad)"/>
        <ellipse cx="${f(-ua * 0.15)}" cy="8" rx="${f(ua * 1.08)}" ry="${f(ua * 1.2)}" fill="url(#skinGrad)"/>
        <path d="M ${f(-ua * 0.9)} ${f(ua * 1.1)} Q ${f(-ua * 0.2)} ${f(ua * 1.6)} ${f(ua * 0.7)} ${f(ua * 1.0)}" stroke="#${skinLine}" stroke-width="1.4" fill="none" opacity="${f(def * 0.6)}"/>
        <path d="M ${f(-ua * 0.55)} 40 Q ${f(-ua * 0.95)} 62 ${f(-fa * 0.7)} 90" stroke="#${skinLine}" stroke-width="1.2" fill="none" opacity="${f(def * 0.45)}"/>
        <ellipse cx="0" cy="188" rx="${f(fa * 0.72)}" ry="14" fill="#${skin}"/>
        <path d="M ${f(-fa * 0.5)} 192 q 4 8 ${f(fa * 0.5)} 9" stroke="#${skinLine}" stroke-width="1" fill="none" opacity=".5"/>
      </g>
    </g>`;
  };

  const pec = (side) => `
    <path d="M ${cx + side * 3} ${f(shoulderY + 24)}
             C ${f(cx + side * S * 0.35)} ${f(shoulderY + 30 + m * 22)} ${f(cx + side * S * 0.72)} ${f(shoulderY + 26 + m * 16)} ${f(cx + side * (S - 16))} ${f(shoulderY + 12)}"
          stroke="#${skinLine}" stroke-width="${f(1.2 + m * 0.8)}" fill="none" opacity="${f(0.25 + def * 0.55)}"/>
    <circle cx="${f(cx + side * S * 0.42)}" cy="${f(shoulderY + 26 + m * 10)}" r="2.3" fill="#${skinLine}" opacity=".55"/>`;

  const absRows = [0, 1, 2].map((i) => {
    const y = shoulderY + 64 + m * 6 + i * 25;
    const w = W * 0.62;
    return `<path d="M ${f(cx - w)} ${f(y)} Q ${cx - 4} ${f(y + 4)} ${cx} ${f(y + 1)} Q ${cx + 4} ${f(y + 4)} ${f(cx + w)} ${f(y)}"
                 stroke="#${skinLine}" stroke-width="1.3" fill="none"/>`;
  }).join('');

  const eye = (side) => {
    const ex = cx + side * 12.5;
    const ey = 99 + headDrop;
    const id = `eye${side < 0 ? 'L' : 'R'}`;
    return `
    <g class="eye">
      <clipPath id="${id}"><ellipse cx="${ex}" cy="${f(ey)}" rx="6.6" ry="4.4"/></clipPath>
      <ellipse cx="${ex}" cy="${f(ey)}" rx="6.6" ry="4.4" fill="#fbf7f2"/>
      <circle cx="${ex + side * 0.4}" cy="${f(ey + 0.3)}" r="3.4" fill="#4d5866" clip-path="url(#${id})"/>
      <circle cx="${ex + side * 0.4}" cy="${f(ey + 0.3)}" r="1.6" fill="#1b1f25" clip-path="url(#${id})"/>
      <circle cx="${ex + 1.4}" cy="${f(ey - 1.2)}" r="0.9" fill="#fff" clip-path="url(#${id})"/>
      <rect x="${ex - 8}" y="${f(ey - 5)}" width="16" height="${f(0.5 + lid * 8.8)}" fill="#${skin}" clip-path="url(#${id})"/>
      <path d="M ${ex - 6.8} ${f(ey - 4.4 + lid * 8.8 * 0.95)} Q ${ex} ${f(ey - 6 + lid * 8.8)} ${ex + 6.8} ${f(ey - 4.4 + lid * 8.8 * 0.95)}"
            stroke="#3a2a22" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    </g>
    <path d="M ${ex - 6} ${f(ey + 6)} Q ${ex} ${f(ey + 9.5)} ${ex + 6} ${f(ey + 6)}" stroke="#8a6276" stroke-width="1.4" fill="none" opacity="${f(tired * 0.7)}"/>
    <path d="M ${ex - side * 8} ${f(ey - 9 + (side < 0 ? 0 : 0))} Q ${ex} ${f(ey - 12)} ${ex + side * 8} ${f(ey - 9 - browTilt * 0)}"
          transform="rotate(${f(side * browTilt)} ${ex} ${f(ey - 10)})"
          stroke="#${hair}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
  };

  const mouthY = 122 + headDrop;
  const mouth = smile > 5
    ? `<path d="M ${cx - 12} ${mouthY} Q ${cx} ${f(mouthY + smile * 1.15)} ${cx + 12} ${mouthY} Q ${cx} ${f(mouthY + 3)} ${cx - 12} ${mouthY} Z" fill="#7a3b38"/>
       <path d="M ${cx - 10.5} ${f(mouthY + 0.8)} Q ${cx} ${f(mouthY + 3.5)} ${cx + 10.5} ${f(mouthY + 0.8)} L ${cx + 9} ${f(mouthY + smile * 0.55)} Q ${cx} ${f(mouthY + smile * 0.7)} ${cx - 9} ${f(mouthY + smile * 0.55)} Z" fill="#fbf6ee"/>
       <path d="M ${cx - 12.5} ${f(mouthY - 0.5)} Q ${cx - 14.5} ${f(mouthY - 2)} ${cx - 14} ${f(mouthY - 3.5)} M ${cx + 12.5} ${f(mouthY - 0.5)} Q ${cx + 14.5} ${f(mouthY - 2)} ${cx + 14} ${f(mouthY - 3.5)}" stroke="#${skinLine}" stroke-width="1.1" fill="none"/>`
    : `<path d="M ${cx - 9} ${mouthY + 1} Q ${cx} ${f(mouthY + 1 + smile)} ${cx + 9} ${mouthY + 1}" stroke="#8a4a44" stroke-width="2" fill="none" stroke-linecap="round"/>`;

  const freckles = [[-17, 108], [-14, 111], [-19, 112], [15, 108], [18, 111], [13, 112], [-3, 106], [3, 106]]
    .map(([x, y]) => `<circle cx="${cx + x}" cy="${f(y + headDrop)}" r=".8" fill="#b67a5a" opacity=".5"/>`).join('');

  const hairTop = 40 + headDrop;
  const hy = (y) => f(y + headDrop);
  const hairPath = `
    M ${cx - 36} ${hy(108)}
    C ${cx - 45} ${hy(70)} ${cx - 34} ${hy(37)} ${cx - 2} ${f(hairTop - 4)}
    C ${cx + 31} ${hy(34)} ${cx + 47} ${hy(64)} ${cx + 37} ${hy(108)}
    L ${cx + 32} ${hy(92)} Q ${cx + 28} ${hy(82)} ${cx + 24} ${hy(90)}
    Q ${cx + 20} ${hy(76)} ${cx + 14} ${hy(88)} Q ${cx + 9} ${hy(74)} ${cx + 4} ${hy(89)}
    Q ${cx - 1} ${hy(75)} ${cx - 7} ${hy(90)} Q ${cx - 12} ${hy(76)} ${cx - 17} ${hy(88)}
    Q ${cx - 22} ${hy(76)} ${cx - 27} ${hy(87)} Q ${cx - 31} ${hy(84)} ${cx - 32} ${hy(96)} Z`;
  const tufts = `
    M ${cx - 24} ${hy(44)} Q ${cx - 31} ${hy(29)} ${cx - 17} ${hy(27)} Q ${cx - 20} ${hy(37)} ${cx - 11} ${hy(40)} Z
    M ${cx - 6} ${hy(36)} Q ${cx - 3} ${hy(21)} ${cx + 9} ${hy(24)} Q ${cx + 4} ${hy(32)} ${cx + 9} ${hy(37)} Z
    M ${cx + 13} ${hy(38)} Q ${cx + 27} ${hy(28)} ${cx + 35} ${hy(37)} Q ${cx + 27} ${hy(39)} ${cx + 25} ${hy(48)} Z
    M ${cx - 35} ${hy(60)} Q ${cx - 48} ${hy(56)} ${cx - 44} ${hy(74)} Q ${cx - 40} ${hy(67)} ${cx - 36} ${hy(72)} Z
    M ${cx + 35} ${hy(58)} Q ${cx + 48} ${hy(56)} ${cx + 44} ${hy(74)} Q ${cx + 40} ${hy(67)} ${cx + 37} ${hy(72)} Z`;

  const jeans = `
    M ${cx - H} ${waistY + 4} L ${cx + H} ${waistY + 4}
    L ${cx + H + 3} 336 L ${cx + 33} 494 L ${cx + 8} 494 L ${cx + 2} 350
    L ${cx - 2} 350 L ${cx - 8} 494 L ${cx - 33} 494 L ${cx - H - 3} 336 Z`;

  return `
<svg viewBox="0 0 300 560" xmlns="http://www.w3.org/2000/svg" class="char" style="--breath:${f(lerp(5.8, 3.4, e))}s" aria-hidden="true">
  <defs>
    <linearGradient id="skinGrad" x1="0" x2="1">
      <stop offset="0" stop-color="#${skinShade}"/>
      <stop offset=".45" stop-color="#${skin}"/>
      <stop offset="1" stop-color="#${skinShade}"/>
    </linearGradient>
    <linearGradient id="jeansGrad" x1="0" x2="1">
      <stop offset="0" stop-color="#121318"/>
      <stop offset=".5" stop-color="#25262e"/>
      <stop offset="1" stop-color="#121318"/>
    </linearGradient>
    <radialGradient id="aura" cx=".5" cy=".55" r=".5">
      <stop offset="0" stop-color="var(--accent)" stop-opacity=".45"/>
      <stop offset="1" stop-color="var(--accent)" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
  </defs>

  <ellipse class="aura" cx="${cx}" cy="300" rx="150" ry="230" fill="url(#aura)" opacity="${f(clamp((m - 0.6) * 2.5) * e)}"/>

  <!-- platform -->
  <ellipse cx="${cx}" cy="522" rx="128" ry="24" fill="#0a0d10"/>
  <rect x="${cx - 128}" y="522" width="256" height="16" fill="#07090b"/>
  <ellipse cx="${cx}" cy="538" rx="128" ry="24" fill="#07090b"/>
  <ellipse cx="${cx}" cy="521" rx="112" ry="18" fill="none" stroke="var(--accent)" stroke-width="5" filter="url(#glow)" opacity=".9"/>
  <ellipse cx="${cx}" cy="521" rx="112" ry="18" fill="none" stroke="var(--accent)" stroke-width="2"/>
  <g fill="var(--accent)" class="platform-lights">
    <rect x="${cx - 22}" y="553" width="44" height="4" rx="2"/>
    <rect x="${cx - 100}" y="544" width="30" height="4" rx="2" transform="rotate(10 ${cx - 85} 546)"/>
    <rect x="${cx + 70}" y="544" width="30" height="4" rx="2" transform="rotate(-10 ${cx + 85} 546)"/>
  </g>
  <ellipse cx="${cx}" cy="508" rx="62" ry="8" fill="#000" opacity=".55"/>

  <!-- legs + shoes -->
  <path d="${jeans}" fill="url(#jeansGrad)"/>
  <path d="M ${cx} ${waistY + 16} L ${cx + 1} 350 M ${cx - H + 6} ${waistY + 16} Q ${cx - H + 14} 312 ${cx - 14} ${waistY + 16} M ${cx + H - 6} ${waistY + 16} Q ${cx + H - 14} 312 ${cx + 14} ${waistY + 16}
           M ${cx - 22} 370 L ${cx - 21} 492 M ${cx + 22} 370 L ${cx + 21} 492" stroke="#3a3b46" stroke-width="1.2" fill="none"/>
  <rect x="${cx - H - 1}" y="${waistY + 2}" width="${2 * H + 2}" height="11" rx="2" fill="#1a1b21"/>
  <circle cx="${cx}" cy="${waistY + 8}" r="2" fill="#6f7080"/>
  <path d="M ${cx - 44} 508 Q ${cx - 44} 490 ${cx - 30} 489 L ${cx - 8} 489 Q ${cx - 4} 496 ${cx - 5} 508 Z" fill="#141519"/>
  <path d="M ${cx + 44} 508 Q ${cx + 44} 490 ${cx + 30} 489 L ${cx + 8} 489 Q ${cx + 4} 496 ${cx + 5} 508 Z" fill="#141519"/>
  <path d="M ${cx - 45} 506 L ${cx - 4} 506 M ${cx + 45} 506 L ${cx + 4} 506" stroke="#2c2d35" stroke-width="3"/>

  <!-- upper body breathes -->
  <g class="upper">
    <rect x="${cx - nw}" y="${118 + headDrop}" width="${2 * nw}" height="${40 - headDrop}" fill="url(#skinGrad)"/>
    <path d="${torso}" fill="url(#skinGrad)"/>
    <path d="M ${cx - nw + 2} 140 Q ${cx} ${150} ${cx + nw - 2} 140" stroke="#${skinLine}" stroke-width="1.2" fill="none" opacity=".5"/>
    <path d="M ${cx - nw - 4} ${f(shoulderY - 4)} Q ${cx - S * 0.5} ${f(shoulderY + 2)} ${cx - S * 0.62} ${f(shoulderY + 10)} M ${cx + nw + 4} ${f(shoulderY - 4)} Q ${cx + S * 0.5} ${f(shoulderY + 2)} ${cx + S * 0.62} ${f(shoulderY + 10)}"
          stroke="#${skinLine}" stroke-width="1.1" fill="none" opacity="${f(0.25 + def * 0.3)}"/>
    ${pec(-1)}${pec(1)}
    <path d="M ${cx} ${f(shoulderY + 10)} L ${cx} ${f(shoulderY + 30 + m * 14)}" stroke="#${skinLine}" stroke-width="1.2" opacity="${f(0.2 + def * 0.5)}"/>
    <g opacity="${f(def * 0.75)}">
      <path d="M ${cx} ${f(shoulderY + 52)} L ${cx} ${waistY - 6}" stroke="#${skinLine}" stroke-width="1.3"/>
      ${absRows}
      <path d="M ${f(cx - W + 2)} ${f(shoulderY + 70)} Q ${f(cx - W * 0.7)} ${waistY - 20} ${cx - 10} ${waistY + 4} M ${f(cx + W - 2)} ${f(shoulderY + 70)} Q ${f(cx + W * 0.7)} ${waistY - 20} ${cx + 10} ${waistY + 4}"
            stroke="#${skinLine}" stroke-width="1.2" fill="none"/>
    </g>
    <ellipse cx="${cx}" cy="${waistY - 14}" rx="1.6" ry="2.4" fill="#${skinLine}" opacity=".6"/>

    ${armGroup(-1)}${armGroup(1)}

    <g class="head"><g transform="translate(${cx} ${132 + headDrop}) scale(1.12) translate(${-cx} ${-132 - headDrop})">
      <ellipse cx="${cx - 30}" cy="${102 + headDrop}" rx="6" ry="10" fill="#${skinShade}"/>
      <ellipse cx="${cx + 30}" cy="${102 + headDrop}" rx="6" ry="10" fill="#${skinShade}"/>
      <path d="M ${cx - 29} ${88 + headDrop} C ${cx - 29} ${52 + headDrop} ${cx + 29} ${52 + headDrop} ${cx + 29} ${88 + headDrop}
               C ${cx + 29} ${104 + headDrop} ${cx + 25} ${118 + headDrop} ${cx + 14} ${128 + headDrop}
               Q ${cx} ${138 + headDrop} ${cx - 14} ${128 + headDrop}
               C ${cx - 25} ${118 + headDrop} ${cx - 29} ${104 + headDrop} ${cx - 29} ${88 + headDrop} Z" fill="#${skin}"/>
      <ellipse cx="${cx - 18}" cy="${113 + headDrop}" rx="6" ry="3.5" fill="#f08f86" opacity="${f(e * 0.35)}"/>
      <ellipse cx="${cx + 18}" cy="${113 + headDrop}" rx="6" ry="3.5" fill="#f08f86" opacity="${f(e * 0.35)}"/>
      ${freckles}
      ${eye(-1)}${eye(1)}
      <path d="M ${cx - 1} ${102 + headDrop} Q ${cx - 3} ${110 + headDrop} ${cx - 4} ${112 + headDrop} Q ${cx} ${115 + headDrop} ${cx + 4} ${112 + headDrop}" stroke="#${skinLine}" stroke-width="1.3" fill="none" stroke-linecap="round"/>
      ${mouth}
      <g class="hair">
        <path d="${hairPath}" fill="#${hair}"/>
        <path d="${tufts}" fill="#${hair}"/>
        <path d="M ${cx - 20} ${hy(52)} Q ${cx - 12} ${hy(66)} ${cx - 16} ${hy(84)} M ${cx + 2} ${hy(46)} Q ${cx + 6} ${hy(62)} ${cx + 2} ${hy(80)} M ${cx + 20} ${hy(50)} Q ${cx + 24} ${hy(64)} ${cx + 18} ${hy(82)}"
              stroke="#${hairLight}" stroke-width="2" fill="none" stroke-linecap="round" opacity=".8"/>
      </g>
    </g></g>
  </g>

  <g class="zzz" opacity="${tired > 0.6 ? 1 : 0}" fill="var(--sleep)" font-family="Space Grotesk, sans-serif" font-weight="700">
    <text x="${cx + 38}" y="64" font-size="16">z</text>
    <text x="${cx + 50}" y="48" font-size="20">z</text>
    <text x="${cx + 64}" y="30" font-size="26">Z</text>
  </g>
</svg>`;
}
