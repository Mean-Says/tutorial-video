export interface Labels {
  nesteVideo: string;
  passo: string;
  de: string;
  dica: string;
  pronto: string;
  proximo: string;
}

const PT: Labels = { nesteVideo: 'Neste vídeo', passo: 'Passo', de: 'de', dica: 'Dica', pronto: 'Pronto!', proximo: 'Próximo vídeo' };
const EN: Labels = { nesteVideo: 'In this video', passo: 'Step', de: 'of', dica: 'Tip', pronto: 'Done!', proximo: 'Next video' };
const ES: Labels = { nesteVideo: 'En este video', passo: 'Paso', de: 'de', dica: 'Consejo', pronto: '¡Listo!', proximo: 'Próximo video' };

export function labelsFor(idioma: string): Labels {
  const lang = idioma.toLowerCase();
  if (lang.startsWith('en')) return EN;
  if (lang.startsWith('es')) return ES;
  return PT;
}
