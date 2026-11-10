import { loadFont } from '@remotion/google-fonts/Inter';
import React from 'react';
import { AbsoluteFill, Html5Audio, interpolate, Sequence, staticFile } from 'remotion';
import type { EditPlan } from '../schema.ts';
import { Background, OutroCard, ProgressBar, TitleCard } from './components/Cards.tsx';
import { StepScene } from './components/StepScene.tsx';

const { fontFamily } = loadFont('normal', { weights: ['400', '500', '600', '700', '800'], subsets: ['latin', 'latin-ext'] });

export type TutorialProps = { plan: EditPlan };

export const Tutorial: React.FC<TutorialProps> = ({ plan }) => {
  const total = plan.durationInFrames;
  const vol = plan.audio.volume;
  return (
    <AbsoluteFill style={{ fontFamily: `${fontFamily}, -apple-system, 'Helvetica Neue', Arial, sans-serif`, color: plan.theme.text }}>
      <Background theme={plan.theme} />
      {plan.segments.map((s, i) => (
        <Sequence key={i} from={s.from} durationInFrames={s.dur} name={s.kind === 'step' ? `${s.index}. ${s.titulo}` : s.kind}>
          {s.kind === 'intro' ? <TitleCard seg={s} plan={plan} /> : s.kind === 'outro' ? <OutroCard seg={s} plan={plan} /> : <StepScene seg={s} plan={plan} />}
        </Sequence>
      ))}
      <ProgressBar plan={plan} />
      {plan.audio.musica ? (
        <Html5Audio
          src={staticFile(plan.audio.musica)}
          loop
          volume={(f) => interpolate(f, [0, 30, total - 45, total], [0, vol, vol, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
        />
      ) : null}
    </AbsoluteFill>
  );
};
