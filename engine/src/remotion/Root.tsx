import React from 'react';
import { Composition, type CalculateMetadataFunction } from 'remotion';
import { EditPlan } from '../schema.ts';
import { Tutorial, type TutorialProps } from './Tutorial.tsx';

/** Placeholder so Remotion Studio opens without a real plan (intro + outro only). */
const samplePlan: EditPlan = {
  version: 1,
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 240,
  produto: 'Produto',
  tituloVideo: 'Como fazer algo',
  idioma: 'pt-BR',
  theme: {
    bg1: '#0b1020',
    bg2: '#312e81',
    accent: '#8b5cf6',
    text: '#ffffff',
    muted: 'rgba(255,255,255,0.72)',
    surface: 'rgba(255,255,255,0.08)',
    frameBar: '#1b1d2a',
    dark: true,
    janela: true,
  },
  segments: [
    { kind: 'intro', from: 0, dur: 120, titulo: 'Como fazer algo', subtitulo: 'Tutorial', aprendizados: ['Primeiro', 'Segundo'] },
    { kind: 'outro', from: 120, dur: 120, titulo: 'Recapitulando', resumo: ['Primeiro passo', 'Segundo passo'] },
  ],
  audio: { volume: 0.12, cliques: false },
  chapters: [],
};

const calculateMetadata: CalculateMetadataFunction<TutorialProps> = ({ props }) => {
  const plan = EditPlan.parse(props.plan);
  return { durationInFrames: plan.durationInFrames, fps: plan.fps, width: plan.width, height: plan.height, props: { plan } };
};

export const Root: React.FC = () => (
  <Composition
    id="Tutorial"
    component={Tutorial}
    defaultProps={{ plan: samplePlan }}
    calculateMetadata={calculateMetadata}
    durationInFrames={samplePlan.durationInFrames}
    fps={30}
    width={1920}
    height={1080}
  />
);
