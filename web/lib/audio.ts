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

export interface MultiBandLevels extends AudioLevels {
  sub: number; // very low frequencies
  lowMid: number; // between low and mid
  highMid: number; // between mid and high
  treble: number; // high + beyond
  spectralCentroid?: number; // optional descriptor in [0,1]
}

export const DEFAULT_FFT_BANDS: FFTBands = {
  low: 2,
  mid: 24,
  high: 96,
};

export const createAudioContext = (): AudioContext => {
  return new (window.AudioContext || (window as any).webkitAudioContext)();
};

/**
 * Create and configure an AnalyserNode tuned for responsive visuals.
 * - Slightly lower smoothing for quicker attack
 * - Wider decibel range to improve perceived dynamics
 */
export const createAnalyser = (
  context: AudioContext,
  fftSize = 1024,
  options?: {
    smoothingTimeConstant?: number;
    minDecibels?: number;
    maxDecibels?: number;
  }
): AnalyserNode => {
  const analyser = context.createAnalyser();
  analyser.fftSize = fftSize;
  // Defaults optimized for responsiveness; callers can override
  analyser.smoothingTimeConstant = options?.smoothingTimeConstant ?? 0.6;
  analyser.minDecibels = options?.minDecibels ?? -85;
  analyser.maxDecibels = options?.maxDecibels ?? -20;
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

/**
 * Compute multi-band levels with simple geometric spacing and optional centroid.
 * Returns normalized [0,1] values.
 */
export const processMultiBandFFT = (
  analyser: AnalyserNode,
  fftArray: Uint8Array
): MultiBandLevels => {
  analyser.getByteFrequencyData(fftArray as unknown as Uint8Array<ArrayBuffer>);
  const n = fftArray.length;
  if (n === 0) {
    return {
      sub: 0,
      low: 0,
      lowMid: 0,
      mid: 0,
      highMid: 0,
      high: 0,
      treble: 0,
      energy: 0,
      spectralCentroid: 0,
    };
  }

  // Define band ranges over indices (approximately logarithmic by squaring)
  const idx = (t: number) => Math.min(n - 1, Math.max(0, Math.floor(t)));
  const b0 = 0;
  const b1 = idx(n ** 0.35); // sub
  const b2 = idx(n ** 0.5); // low
  const b3 = idx(n ** 0.65); // lowMid
  const b4 = idx(n ** 0.8); // mid
  const b5 = idx(n ** 0.9); // highMid
  const b6 = idx(n ** 0.97); // high
  const b7 = n - 1; // treble

  const avg = (start: number, end: number) => {
    const s = Math.min(start, end);
    const e = Math.max(start, end);
    let sum = 0;
    let count = 0;
    for (let i = s; i <= e; i++) {
      sum += fftArray[i];
      count++;
    }
    return count > 0 ? sum / (count * 255) : 0;
  };

  const sub = avg(b0, b1);
  const low = avg(b1 + 1, b2);
  const lowMid = avg(b2 + 1, b3);
  const mid = avg(b3 + 1, b4);
  const highMid = avg(b4 + 1, b5);
  const high = avg(b5 + 1, b6);
  const treble = avg(b6 + 1, b7);

  // Energy as overall average
  let total = 0;
  for (let i = 0; i < n; i++) total += fftArray[i];
  const energy = total / (n * 255);

  // Spectral centroid (index-weighted average, normalized by n)
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += i * fftArray[i];
  const centroid = total > 1e-6 ? weighted / (total * n) : 0;

  return {
    sub,
    low,
    lowMid,
    mid,
    highMid,
    high,
    treble,
    energy,
    spectralCentroid: centroid,
  };
};

/**
 * Attack/decay smoothing suited for visuals.
 * attack controls rise speed, decay controls fall speed (both 0..1 per frame).
 */
export const smoothAD = (
  current: number,
  previous: number,
  attack = 0.5,
  decay = 0.15
): number => {
  if (current >= previous) {
    return previous + (current - previous) * attack;
  }
  return previous + (current - previous) * decay;
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
