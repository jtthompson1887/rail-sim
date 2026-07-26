/** Clone JSON-shaped data without JSON's coercion of special number values. */
export function clonePlainData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => clonePlainData(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const clone: Record<string, unknown> = {};
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      clone[key] = clonePlainData(record[key]);
    }
    return clone as T;
  }
  return value;
}

/** Structural equality for plain data, using Object.is for numeric authority. */
export function equalPlainData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null
    || typeof left !== 'object' || typeof right !== 'object'
    || Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length
      && left.every((item, index) => equalPlainData(item, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index]
      && equalPlainData(leftRecord[key], rightRecord[key])
    ));
}
