import Decimal from 'decimal.js';

export function roundDecimal(value: Decimal.Value, places = 2): number {
  return new Decimal(value || 0)
    .toDecimalPlaces(places, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function addDecimal(
  left: Decimal.Value,
  right: Decimal.Value,
  places = 2,
): number {
  return roundDecimal(new Decimal(left || 0).plus(right || 0), places);
}

export function subtractDecimal(
  left: Decimal.Value,
  right: Decimal.Value,
  places = 2,
): number {
  return roundDecimal(new Decimal(left || 0).minus(right || 0), places);
}

export function multiplyDecimal(
  left: Decimal.Value,
  right: Decimal.Value,
  places = 2,
): number {
  return roundDecimal(new Decimal(left || 0).times(right || 0), places);
}
