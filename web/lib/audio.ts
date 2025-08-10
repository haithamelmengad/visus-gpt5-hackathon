/**
 * Audio processing utilities for FFT analysis and visualization
 */

export interface FFTBands {
  low: number;
  mid: number;
  high: number;
}

export interface AudioLevels {
  low: number;
  mid: number;
  high: number;
  energy: number;
}

export const DEFAULT_FFT_BANDS: FFTBands = {
  low: 2,
  mid: 24,
  high: 96,
};

export const createAudioContext = (): AudioContext => {
  return new (window.AudioContext || (window as any).webkitAudioContext)();
};

export const createAnalyser = (
  context: AudioContext,
  fftSize = 1024
): AnalyserNode => {
  const analyser = context.createAnalyser();
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = 0.9; // Higher smoothing for more uniform data
  return analyser;
};

export const processFFTData = (
  analyser: AnalyserNode,
  fftArray: Uint8Array,
  fftBands: FFTBands = DEFAULT_FFT_BANDS
): AudioLevels => {
  analyser.getByteFrequencyData(fftArray as unknown as Uint8Array<ArrayBuffer>);

  const low = fftArray[fftBands.low] ?? 0;
  const mid = fftArray[fftBands.mid] ?? 0;
  const high = fftArray[fftBands.high] ?? 0;

  // Calculate energy with better normalization
  const energy = (low + mid + high) / (3 * 255);

  return {
    low: low / 255,
    mid: mid / 255,
    high: high / 255,
    energy,
  };
};

export const smoothAudioLevel = (
  current: number,
  previous: number,
  smoothingFactor = 0.85
): number => {
  return (current + previous) / 2;
};

export const calculateAudioScalar = (
  levels: AudioLevels,
  spotifyScalar: number,
  energyWeight = 0.55,
  spotifyWeight = 0.45
): number => {
  return energyWeight * levels.energy + spotifyWeight * spotifyScalar;
};
