import { isObject, isStringArray, finding, emitRemoteRefFindings } from './common.js';

export function validateJsonSchema(ctx) {
  const findings = [];
  const { data } = ctx;

  if (!isObject(data)) {
    findings.push(finding(ctx, [], 'jsonschema/root-type', 'error',
      'JSON Schema root must be an object'));
    return findings;
  }

  if ('type' in data) {
    const t = data.type;
    const valid = typeof t === 'string' || isStringArray(t);
    if (!valid) {
      findings.push(finding(ctx, ['type'], 'jsonschema/type-value', 'error',
        '"type" must be a string or array of strings'));
    }
  }

  if ('properties' in data && !isObject(data.properties)) {
    findings.push(finding(ctx, ['properties'], 'jsonschema/properties-object', 'error',
      '"properties" must be an object'));
  }

  if ('required' in data && !isStringArray(data.required)) {
    findings.push(finding(ctx, ['required'], 'jsonschema/required-array', 'error',
      '"required" must be an array of strings'));
  }

  if ('items' in data) {
    const items = data.items;
    if (items !== null && !isObject(items) && !Array.isArray(items)) {
      findings.push(finding(ctx, ['items'], 'jsonschema/items-shape', 'warning',
        '"items" should be an object or array of objects'));
    }
  }

  findings.push(...emitRemoteRefFindings(ctx, 'jsonschema'));
  return findings;
}
