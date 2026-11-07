import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Traced from the logo: the katakana オススメ, one constellation each. A star is [x, y, points]. */
const glyphs: { stars: [number, number, 4 | 5][]; lines: [number, number][] }[] = [
  {
    stars: [
      [229.5, 57.5, 4],
      [83, 139.5, 4],
      [230, 139.5, 5],
      [343.5, 139.5, 4],
      [89.5, 323.5, 5],
      [230, 332, 4],
    ],
    lines: [
      [0, 2],
      [1, 2],
      [2, 3],
      [2, 4],
      [2, 5],
    ],
  },
  {
    stars: [
      [513, 104, 5],
      [742, 102.5, 5],
      [633, 218.5, 5],
      [521.5, 323.5, 5],
      [759, 334, 5],
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
      [2, 4],
    ],
  },
  {
    stars: [
      [87.5, 537.5, 5],
      [322, 538.5, 4],
      [211.5, 653.5, 4],
      [98.5, 762.5, 4],
      [337.5, 767.5, 5],
    ],
    lines: [
      [0, 1],
      [1, 2],
      [2, 3],
      [2, 4],
    ],
  },
  {
    stars: [
      [733.5, 513, 4],
      [512, 591.5, 5],
      [616.5, 661, 4],
      [527.5, 773, 5],
      [758, 755.5, 5],
    ],
    lines: [
      [0, 2],
      [1, 2],
      [2, 3],
      [2, 4],
    ],
  },
];

function starPath(x: number, y: number, points: number, radius: number) {
  const inner = radius * (points === 5 ? 0.38 : 0.3);
  const corners = Array.from({ length: points * 2 }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / points;
    const reach = index % 2 === 0 ? radius : inner;
    return `${(x + reach * Math.cos(angle)).toFixed(1)} ${(y + reach * Math.sin(angle)).toFixed(1)}`;
  });
  return `M${corners.join('L')}Z`;
}

/** Without `line`, lines stay a hairline at any size. */
function Glyph({ index, line, star }: { index: number; line?: number; star: number }) {
  const { stars, lines } = glyphs[index % glyphs.length] ?? { stars: [], lines: [] };
  return (
    <>
      <g
        stroke="var(--mark-line, currentColor)"
        strokeLinecap="round"
        strokeWidth={line ?? 1}
      >
        {lines.map(([from, to]) => {
          const [x1 = 0, y1 = 0] = stars[from] ?? [];
          const [x2 = 0, y2 = 0] = stars[to] ?? [];
          return (
            <line
              key={`${String(from)}-${String(to)}`}
              vectorEffect={line === undefined ? 'non-scaling-stroke' : undefined}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
            />
          );
        })}
      </g>
      <path
        fill="var(--mark-star, var(--star))"
        d={stars.map(([x, y, points]) => starPath(x, y, points, star)).join('')}
      />
    </>
  );
}

/** The app icon: fixed colours, the same on both themes. Stars and lines are thickened for small sizes. */
export function LogoMark({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 846 846"
      aria-hidden
      className={cn('size-9 shrink-0 [--mark-line:#fff] [--mark-star:#e5bd41]', className)}
      {...props}
    >
      <rect width="846" height="846" rx="85" fill="#000" />
      <rect x="11" y="11" width="824" height="824" rx="75" fill="none" stroke="#fff" strokeWidth="9" />
      {glyphs.map((_, index) => (
        <Glyph key={index} index={index} line={17} star={48} />
      ))}
    </svg>
  );
}

/** The mark and the name, as the header and logged-out pages show them. */
export function LogoLockup() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="font-heading text-xl font-medium tracking-tight">Osusume</span>
    </span>
  );
}

const glyphBoxes = ['40 15 345 350', '470 60 330 315', '45 495 335 315', '470 470 330 345'];

/**
 * One letter of the logo as a loose constellation, on the theme's own colours. Decoration for empty
 * states and cover fallbacks; any `index` works, so it can come from a hash.
 */
export function Constellation({ index, className }: { index: number; className?: string }) {
  return (
    <svg viewBox={glyphBoxes[index % glyphBoxes.length]} aria-hidden className={className}>
      <Glyph index={index} star={22} />
    </svg>
  );
}

/** The whole name, drawn large and without the tile. For the logged-out pages' sky. */
export function ConstellationSky({ className }: { className?: string }) {
  return (
    <svg viewBox="30 10 780 810" aria-hidden className={className}>
      {glyphs.map((_, index) => (
        <Glyph key={index} index={index} star={16} />
      ))}
    </svg>
  );
}
