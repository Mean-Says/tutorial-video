import React from 'react';
import { AbsoluteFill, Freeze, Img, interpolate, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { EditPlan, IntroSegment, OutroSegment, ResolvedTheme } from '../../schema.ts';
import { labelsFor } from '../labels.ts';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export const Background: React.FC<{ theme: ResolvedTheme }> = ({ theme }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(1100px 760px at 12% 8%, ${theme.bg2} 0%, transparent 62%), radial-gradient(900px 640px at 92% 105%, ${theme.accent}40 0%, transparent 60%), ${theme.bg1}`,
    }}
  />
);

export const CheckIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ flex: '0 0 auto' }}>
    <circle cx="12" cy="12" r="11" fill={color} />
    <path d="M7 12.5l3.2 3.2L17.5 8.5" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function useRise() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (delay: number): React.CSSProperties => {
    const p = spring({ frame: frame - delay, fps, config: { damping: 200 } });
    return { opacity: p, transform: `translateY(${(1 - p) * 26}px)` };
  };
}

const Brand: React.FC<{ plan: EditPlan; style: React.CSSProperties }> = ({ plan, style }) => (
  <div style={{ ...style, display: 'flex', alignItems: 'center', gap: 16, marginBottom: 30 }}>
    {plan.theme.logo ? <Img src={staticFile(plan.theme.logo)} style={{ height: 52 }} /> : null}
    <span style={{ fontSize: 26, fontWeight: 700, color: plan.theme.accent, letterSpacing: 2, textTransform: 'uppercase' }}>{plan.produto}</span>
  </div>
);

const ResultPreview: React.FC<{ preview: NonNullable<IntroSegment['preview']>; plan: EditPlan }> = ({ preview, plan }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - 6, fps, config: { damping: 18, stiffness: 90 } });
  const width = 820;
  const height = width / preview.aspect;
  return (
    <div style={{ position: 'absolute', right: 120, top: '50%', perspective: 2200, transform: `translateY(-50%)` }}>
      <div
        style={{
          width,
          borderRadius: 14,
          overflow: 'hidden',
          background: plan.theme.frameBar,
          boxShadow: `0 40px 90px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08), 0 0 120px ${plan.theme.accent}33`,
          transform: `rotateY(${-16 + 4 * p}deg) rotateX(4deg) translateX(${(1 - p) * 140}px)`,
          opacity: p,
        }}
      >
        <div style={{ height: 26, display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px' }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <span key={c} style={{ width: 9, height: 9, borderRadius: 5, background: c }} />
          ))}
        </div>
        <div style={{ position: 'relative', width, height }}>
          <Freeze frame={0}>
            <OffthreadVideo
              src={staticFile(preview.src)}
              trimBefore={Math.round(preview.t * fps)}
              muted
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill' }}
            />
          </Freeze>
        </div>
      </div>
    </div>
  );
};

export const TitleCard: React.FC<{ seg: IntroSegment; plan: EditPlan }> = ({ seg, plan }) => {
  const frame = useCurrentFrame();
  const rise = useRise();
  const t = plan.theme;
  const L = labelsFor(plan.idioma);
  const fadeOut = interpolate(frame, [seg.dur - 10, seg.dur], [1, 0], clamp);
  const textWidth = seg.preview ? 860 : 1420;
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: seg.preview ? '0 0 0 150px' : '0 220px', opacity: fadeOut }}>
      {seg.preview ? <ResultPreview preview={seg.preview} plan={plan} /> : null}
      <Brand plan={plan} style={rise(0)} />
      <div style={{ ...rise(4), fontSize: seg.preview ? 72 : 82, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.6, maxWidth: textWidth }}>{seg.titulo}</div>
      {seg.subtitulo ? <div style={{ ...rise(8), fontSize: 32, color: t.muted, marginTop: 22, maxWidth: textWidth }}>{seg.subtitulo}</div> : null}
      {seg.aprendizados.length > 0 ? (
        <div style={{ marginTop: 60 }}>
          <div style={{ ...rise(12), fontSize: 22, fontWeight: 700, color: t.muted, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 20 }}>
            {L.nesteVideo}
          </div>
          {seg.aprendizados.map((a, i) => (
            <div key={i} style={{ ...rise(16 + i * 5), display: 'flex', alignItems: 'center', gap: 18, fontSize: seg.preview ? 32 : 36, fontWeight: 500, marginBottom: 16, maxWidth: textWidth }}>
              <CheckIcon color={t.accent} />
              <span>{a}</span>
            </div>
          ))}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const OutroCard: React.FC<{ seg: OutroSegment; plan: EditPlan }> = ({ seg, plan }) => {
  const frame = useCurrentFrame();
  const rise = useRise();
  const t = plan.theme;
  const L = labelsFor(plan.idioma);
  const fadeIn = interpolate(frame, [0, 8], [0, 1], clamp);
  const twoCols = seg.resumo.length > 6;
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: '0 220px', opacity: fadeIn }}>
      <div style={{ ...rise(0), display: 'flex', alignItems: 'center', gap: 14, fontSize: 30, fontWeight: 700, color: t.accent }}>
        <CheckIcon color={t.accent} size={36} />
        {L.pronto}
      </div>
      <div style={{ ...rise(4), fontSize: 68, fontWeight: 800, letterSpacing: -1.2, margin: '14px 0 40px' }}>{seg.titulo}</div>
      <div style={{ columnCount: twoCols ? 2 : 1, columnGap: 80, maxWidth: twoCols ? 1480 : 1200 }}>
        {seg.resumo.map((r, i) => (
          <div key={i} style={{ ...rise(8 + i * 3), breakInside: 'avoid', display: 'flex', alignItems: 'center', gap: 18, fontSize: twoCols ? 28 : 32, marginBottom: 18 }}>
            <span
              style={{
                width: 44,
                height: 44,
                flex: '0 0 auto',
                borderRadius: 22,
                background: t.surface,
                border: `2px solid ${t.accent}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 22,
              }}
            >
              {i + 1}
            </span>
            <span>{r}</span>
          </div>
        ))}
      </div>
      {seg.proximo ? (
        <div
          style={{
            ...rise(14 + seg.resumo.length * 3),
            marginTop: 40,
            alignSelf: 'flex-start',
            padding: '16px 26px',
            borderRadius: 14,
            background: t.surface,
            border: `1px solid ${t.accent}66`,
            fontSize: 28,
          }}
        >
          <span style={{ color: t.muted }}>{L.proximo} → </span>
          <b>{seg.proximo}</b>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const ProgressBar: React.FC<{ plan: EditPlan }> = ({ plan }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        bottom: 0,
        height: 5,
        width: `${(frame / plan.durationInFrames) * 100}%`,
        background: plan.theme.accent,
        opacity: 0.85,
      }}
    />
  );
};
