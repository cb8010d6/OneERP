/**
 * Round a number to 2 decimal places (half-up).
 * Use for all monetary calculations in the frontend.
 */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
