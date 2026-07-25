const COEFFICIENT_EPSILON = 1e-14;
const ROOT_VALUE_EPSILON = 1e-11;
const ROOT_POSITION_EPSILON = 1e-9;
const ROOT_CLUSTER_EPSILON = 1e-7;
const BISECTION_STEPS = 64;

function normalise(coefficients: readonly number[]): number[] {
  const scale = Math.max(0, ...coefficients.map(Math.abs));
  if (!Number.isFinite(scale) || scale === 0) return [];

  const result = coefficients.map((coefficient) => coefficient / scale);
  while (
    result.length > 0
    && Math.abs(result[result.length - 1]) <= COEFFICIENT_EPSILON
  ) {
    result.pop();
  }
  return result;
}

function evaluate(coefficients: readonly number[], t: number): number {
  let value = 0;
  for (let index = coefficients.length - 1; index >= 0; index--) {
    value = value * t + coefficients[index];
  }
  return value;
}

function addRoot(roots: number[], root: number): void {
  const clamped = Math.max(0, Math.min(1, root));
  if (roots.every((existing) => Math.abs(existing - clamped) > ROOT_POSITION_EPSILON)) {
    roots.push(clamped);
  }
}

function mergeRootClusters(roots: readonly number[]): number[] {
  const sorted = [...roots].sort((left, right) => left - right);
  const clusters: number[][] = [];
  for (const root of sorted) {
    const cluster = clusters[clusters.length - 1];
    if (cluster && root - cluster[cluster.length - 1] <= ROOT_CLUSTER_EPSILON) {
      cluster.push(root);
    } else {
      clusters.push([root]);
    }
  }
  return clusters.map(
    (cluster) => cluster.reduce((sum, root) => sum + root, 0) / cluster.length,
  );
}

function isolateNormalised(coefficients: readonly number[]): number[] {
  const degree = coefficients.length - 1;
  if (degree < 1) return [];
  if (degree === 1) {
    const root = -coefficients[0] / coefficients[1];
    return root >= -ROOT_POSITION_EPSILON && root <= 1 + ROOT_POSITION_EPSILON
      ? [Math.max(0, Math.min(1, root))]
      : [];
  }

  const derivative = normalise(
    coefficients.slice(1).map((coefficient, index) => coefficient * (index + 1)),
  );
  const stationaryRoots = isolateNormalised(derivative);
  const boundaries = [0, ...stationaryRoots, 1]
    .sort((left, right) => left - right)
    .filter((value, index, values) => (
      index === 0 || value - values[index - 1] > ROOT_POSITION_EPSILON
    ));
  const roots: number[] = [];

  for (const boundary of boundaries) {
    if (Math.abs(evaluate(coefficients, boundary)) <= ROOT_VALUE_EPSILON) {
      addRoot(roots, boundary);
    }
  }

  for (let index = 1; index < boundaries.length; index++) {
    let low = boundaries[index - 1];
    let high = boundaries[index];
    let lowValue = evaluate(coefficients, low);
    const highValue = evaluate(coefficients, high);
    if (lowValue === 0 || highValue === 0 || Math.sign(lowValue) === Math.sign(highValue)) {
      continue;
    }

    for (let iteration = 0; iteration < BISECTION_STEPS; iteration++) {
      const midpoint = (low + high) / 2;
      const midpointValue = evaluate(coefficients, midpoint);
      if (midpointValue === 0) {
        low = midpoint;
        high = midpoint;
        break;
      }
      if (Math.sign(midpointValue) === Math.sign(lowValue)) {
        low = midpoint;
        lowValue = midpointValue;
      } else {
        high = midpoint;
      }
    }
    addRoot(roots, (low + high) / 2);
  }

  return mergeRootClusters(roots);
}

/**
 * Finds every distinct real root of an ascending-order polynomial on [0, 1].
 * Recursive derivative isolation bounds the work by the polynomial degree.
 */
export function realPolynomialRootsInUnitInterval(
  coefficients: readonly number[],
): number[] {
  return isolateNormalised(normalise(coefficients));
}
