import React from 'react';
import { AbsoluteFill, Freeze, Html5Audio, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CalloutFx, Clip, EditPlan, KeyFx, ResolvedTheme, StepSegment } from '../../schema.ts';
import { labelsFor } from '../labels.ts';
import { cameraAt, cameraTransform, cursorAt, stepLayout, type StepLayout } from '../layout.ts';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const ClipVideo: React.FC<{ clip: Clip; fps: number }> = ({ clip, fps }) => {
  const video = (
    <OffthreadVideo
      src={staticFile(clip.src)}
      trimBefore={Math.round(clip.srcStart * fps)}
      playbackRate={clip.rate}
      muted
      style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: 'fill' }}
    />
  );
  return clip.freeze ? <Freeze frame={0}>{video}</Freeze> : video;
};

const WindowBar: React.FC<{ url?: string; theme: ResolvedTheme; height: number }> = ({ url, theme, height }) => (
  <div
    style={{
      position: 'relative',
      height,
      display: 'flex',
      alignItems: 'center',
      padding: '0 18px',
      background: theme.frameBar,
      borderBottom: `1px solid ${theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}`,
    }}
  >
    <div style={{ display: 'flex', gap: 8 }}>
      {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
        <span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />
      ))}
    </div>
    {url ? (
      <div
        style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          maxWidth: '52%',
          height: 26,
          padding: '0 16px',
          borderRadius: 8,
          background: theme.dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 15,
          color: theme.muted,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" style={{ flex: '0 0 auto' }}>
          <path d="M6 10V7a6 6 0 1112 0v3h1v12H5V10h1zm2 0h8V7a4 4 0 10-8 0v3z" fill="currentColor" />
        </svg>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{url}</span>
      </div>
    ) : null}
  </div>
);

const Cursor: React.FC<{ x: number; y: number; size: number; pressed: boolean }> = ({ x, y, size, pressed }) => {
  const s = size / 28;
  return (
    <svg
      width={28}
      height={28}
      viewBox="0 0 28 28"
      style={{
        position: 'absolute',
        left: x - 5 * s,
        top: y - 3 * s,
        transform: `scale(${s * (pressed ? 0.86 : 1)})`,
        transformOrigin: '5px 3px',
        filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.35))',
        overflow: 'visible',
      }}
    >
      <path d="M5 3 L5 22.5 L10.2 17.6 L13.6 25.2 L17.1 23.7 L13.8 16.3 L20.8 16.3 Z" fill="#111" stroke="#fff" strokeWidth={1.7} strokeLinejoin="round" />
    </svg>
  );
};

const Ripples: React.FC<{ seg: StepSegment; frame: number; L: StepLayout; accent: string }> = ({ seg, frame, L, accent }) => (
  <>
    {seg.clicks
      .filter((c) => frame >= c.f && frame < c.f + 18)
      .map((c, i) => {
        const p = (frame - c.f) / 18;
        const r = 8 + 38 * (1 - Math.pow(1 - p, 3));
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: c.x * L.cw - r,
              top: c.y * L.ch - r,
              width: 2 * r,
              height: 2 * r,
              borderRadius: '50%',
              border: `3px solid ${accent}`,
              background: `${accent}33`,
              opacity: 0.7 * (1 - p),
            }}
          />
        );
      })}
  </>
);

const Callout: React.FC<{ c: CalloutFx; frame: number; fps: number; L: StepLayout; z: number; accent: string }> = ({ c, frame, fps, L, z, accent }) => {
  const local = frame - c.f;
  const pin = spring({ frame: local, fps, config: { damping: 16, stiffness: 170 } });
  const out = interpolate(local, [c.dur - 8, c.dur], [1, 0], clamp);
  const [x, y, w, h] = c.rect;
  const pad = 6 / z;
  const left = x * L.cw - pad;
  const top = y * L.ch - pad;
  const bw = w * L.cw + 2 * pad;
  const bh = h * L.ch + 2 * pad;
  const above = y + h > 0.78;
  const alignRight = x + w / 2 > 0.62;
  const anchorX = alignRight ? left + bw : left;
  const anchorY = above ? top - 10 / z : top + bh + 10 / z;
  return (
    <div style={{ opacity: Math.min(pin, out) }}>
      <div
        style={{
          position: 'absolute',
          left,
          top,
          width: bw,
          height: bh,
          borderRadius: 10 / z,
          border: `${3 / z}px solid ${accent}`,
          boxShadow: `0 0 0 ${6 / z}px ${accent}33, 0 0 ${24 / z}px ${accent}55`,
          transform: `scale(${1.08 - 0.08 * pin})`,
        }}
      />
      {c.label ? (
        <div style={{ position: 'absolute', left: anchorX, top: anchorY, transform: `scale(${1 / z})`, transformOrigin: '0 0' }}>
          <div
            style={{
              transform: `translate(${alignRight ? '-100%' : '0'}, ${above ? '-100%' : '0'})`,
              background: accent,
              color: '#fff',
              fontSize: 22,
              fontWeight: 600,
              lineHeight: 1.25,
              padding: '9px 15px',
              borderRadius: 10,
              boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
              width: 'max-content',
              maxWidth: 520,
            }}
          >
            {c.label}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const Keycaps: React.FC<{ keys: KeyFx[]; frame: number; fps: number }> = ({ keys, frame, fps }) => {
  const k = keys.filter((x) => frame >= x.f && frame < x.f + x.dur).at(-1);
  if (!k) return null;
  const local = frame - k.f;
  const p = spring({ frame: local, fps, config: { damping: 200 }, durationInFrames: 8 });
  const out = interpolate(local, [k.dur - 6, k.dur], [1, 0], clamp);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 28,
        display: 'flex',
        justifyContent: 'center',
        opacity: Math.min(p, out),
        transform: `translateY(${(1 - p) * 12}px)`,
      }}
    >
      <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderRadius: 16, background: 'rgba(12,12,18,0.82)', boxShadow: '0 12px 30px rgba(0,0,0,0.35)' }}>
        {k.label.split('+').map((part, i) => (
          <span
            key={i}
            style={{
              minWidth: 46,
              padding: '8px 14px',
              borderRadius: 9,
              background: 'rgba(255,255,255,0.12)',
              border: '1px solid rgba(255,255,255,0.18)',
              borderBottomWidth: 3,
              color: '#fff',
              fontSize: 26,
              fontWeight: 600,
              textAlign: 'center',
            }}
          >
            {part}
          </span>
        ))}
      </div>
    </div>
  );
};

const Caption: React.FC<{ seg: StepSegment; plan: EditPlan; L: StepLayout; frame: number; fps: number }> = ({ seg, plan, L, frame, fps }) => {
  const t = plan.theme;
  const labels = labelsFor(plan.idioma);
  const p = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 14 });
  const tip = interpolate(frame, [Math.round(0.8 * fps), Math.round(1.1 * fps)], [0, 1], clamp);
  return (
    <div
      style={{
        position: 'absolute',
        left: L.x,
        width: L.fw,
        top: L.captionTop,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 22,
        opacity: p,
        transform: `translateY(${(1 - p) * 14}px)`,
      }}
    >
      <div
        style={{
          flex: '0 0 auto',
          width: 58,
          height: 58,
          borderRadius: 29,
          background: t.accent,
          color: '#fff',
          fontSize: 28,
          fontWeight: 800,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: `0 8px 24px ${t.accent}55`,
        }}
      >
        {seg.index}
      </div>
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <div style={{ fontSize: 38, fontWeight: 700, lineHeight: 1.15, letterSpacing: -0.4 }}>{seg.titulo}</div>
        {seg.texto ? <div style={{ fontSize: 26, color: t.muted, marginTop: 8, lineHeight: 1.3 }}>{seg.texto}</div> : null}
        {seg.dica ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, fontSize: 22, color: t.text, opacity: tip }}>
            <svg width="22" height="22" viewBox="0 0 24 24" style={{ flex: '0 0 auto' }}>
              <path d="M9 21h6v-1H9v1zm3-19a7 7 0 00-4 12.7V17a1 1 0 001 1h6a1 1 0 001-1v-2.3A7 7 0 0012 2z" fill={t.accent} />
            </svg>
            <span>
              <b style={{ color: t.accent }}>{labels.dica}:</b> {seg.dica}
            </span>
          </div>
        ) : null}
      </div>
      <div style={{ flex: '0 0 auto', textAlign: 'right', paddingTop: 8 }}>
        <div style={{ fontSize: 19, color: t.muted, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' }}>
          {labels.passo} {seg.index} {labels.de} {seg.total}
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
          {Array.from({ length: seg.total }, (_, i) => (
            <span key={i} style={{ width: 22, height: 6, borderRadius: 3, background: i < seg.index ? t.accent : t.surface }} />
          ))}
        </div>
      </div>
    </div>
  );
};

export const StepScene: React.FC<{ seg: StepSegment; plan: EditPlan }> = ({ seg, plan }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = plan.theme;
  const L = stepLayout(seg.aspect, t.janela);
  const cam = cameraAt(seg.camera, frame);
  const cur = cursorAt(seg.cursor, frame);
  const enter = seg.index === 1 ? spring({ frame, fps, config: { damping: 200 }, durationInFrames: 16 }) : 1;
  const url = [...seg.urls].reverse().find((u) => u.f <= frame)?.url ?? seg.urls[0]?.url;
  const pressed = seg.clicks.some((c) => frame >= c.f - 2 && frame <= c.f + 3);

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: L.x,
          top: L.y,
          width: L.fw,
          height: L.fh,
          borderRadius: 16,
          overflow: 'hidden',
          background: t.frameBar,
          boxShadow: '0 30px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.08)',
          opacity: enter,
          transform: `scale(${0.96 + 0.04 * enter})`,
        }}
      >
        {t.janela ? <WindowBar url={url} theme={t} height={L.bar} /> : null}
        <div style={{ position: 'absolute', left: 0, top: L.bar, width: L.cw, height: L.ch, overflow: 'hidden', background: '#000' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, width: L.cw, height: L.ch, transformOrigin: '0 0', transform: cameraTransform(cam, L.cw, L.ch) }}>
            {seg.clips.map((c, i) => (
              <Sequence key={i} from={c.from} durationInFrames={c.dur} layout="none">
                <ClipVideo clip={c} fps={fps} />
              </Sequence>
            ))}
            {seg.callouts
              .filter((c) => frame >= c.f && frame < c.f + c.dur)
              .map((c, i) => (
                <Callout key={i} c={c} frame={frame} fps={fps} L={L} z={cam.z} accent={t.accent} />
              ))}
            <Ripples seg={seg} frame={frame} L={L} accent={t.accent} />
            <Cursor x={cur.x * L.cw} y={cur.y * L.ch} size={26 / Math.sqrt(cam.z)} pressed={pressed} />
          </div>
          <Keycaps keys={seg.keys} frame={frame} fps={fps} />
        </div>
      </div>
      <Caption seg={seg} plan={plan} L={L} frame={frame} fps={fps} />
      {plan.audio.cliques
        ? seg.clicks.map((c, i) => (
            <Sequence key={`sfx-${i}`} from={c.f} durationInFrames={Math.round(fps * 0.3)}>
              <Html5Audio src={staticFile('.tut/click.wav')} volume={0.4} />
            </Sequence>
          ))
        : null}
    </AbsoluteFill>
  );
};
