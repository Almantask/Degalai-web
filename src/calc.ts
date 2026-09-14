export interface BenefitInput {
  baselinePrice: number;
  stationPrice: number;
  litres: number;
  extraKm: number;
  extraMin: number;
  consumptionLPer100km: number;
  timeValueEurH: number;
}

export interface BenefitResult {
  savings: number;
  fuelCost: number;
  timeCost: number;
  netBenefit: number;
  deltaPerLitre: number;
}

export function netBenefit(input: BenefitInput): BenefitResult {
  const deltaPerLitre = input.baselinePrice - input.stationPrice;
  const savings = deltaPerLitre * input.litres;
  const fuelCost = input.extraKm * (input.consumptionLPer100km / 100) * input.stationPrice;
  const timeCost = (input.extraMin / 60) * input.timeValueEurH;
  const net = savings - fuelCost - timeCost;
  return {
    savings: round3(savings),
    fuelCost: round3(fuelCost),
    timeCost: round3(timeCost),
    netBenefit: round3(net),
    deltaPerLitre: round3(deltaPerLitre),
  };
}

export function extraMinutesFromKm(extraKm: number, speedKmh = 50): number {
  if (speedKmh <= 0) return 0;
  return (extraKm / speedKmh) * 60;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
