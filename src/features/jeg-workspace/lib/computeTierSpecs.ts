import type { ComputeTier } from './jegSecurity';

export type ComputeTierSpec = {
  cpu: string;
  memory: string;
  gpu: string;
};

export const COMPUTE_TIER_SPECS: Record<ComputeTier, ComputeTierSpec> = {
  'standard-2cpu': { cpu: '2', memory: '8Gi', gpu: '0' },
  'large-8cpu': { cpu: '8', memory: '32Gi', gpu: '0' },
  'gpu-1x': { cpu: '8', memory: '32Gi', gpu: '1' },
};

export const COMPUTE_TIER_KEYS = Object.keys(COMPUTE_TIER_SPECS) as ComputeTier[];
