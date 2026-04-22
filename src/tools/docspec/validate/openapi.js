import { isObject, finding, emitRemoteRefFindings } from './common.js';

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

export function validateOpenapi(ctx) {
  const findings = [];
  const { data } = ctx;

  if (!/^3\.\d+(\.\d+)?$/.test(data.openapi)) {
    findings.push(finding(ctx, ['openapi'], 'openapi/version-format', 'error',
      `openapi field must be a semver string like "3.0.0"; got ${JSON.stringify(data.openapi)}`));
  }

  if (!isObject(data.info) || typeof data.info.title !== 'string' || typeof data.info.version !== 'string') {
    findings.push(finding(ctx, ['info'], 'openapi/info-required', 'error',
      'info.title and info.version are required string fields'));
  }

  const major = parseInt((data.openapi || '').split('.')[0], 10);
  const minor = parseInt((data.openapi || '').split('.')[1], 10);
  const allowAlt = major === 3 && minor >= 1;

  if (!isObject(data.paths)) {
    if (!allowAlt || (!isObject(data.webhooks) && !isObject(data.components))) {
      findings.push(finding(ctx, ['paths'], 'openapi/paths-required', 'error',
        'paths must be an object (OpenAPI 3.1 allows webhooks or components as alternatives)'));
    }
  } else {
    for (const key of Object.keys(data.paths)) {
      if (key.startsWith('x-')) continue;
      if (!key.startsWith('/')) {
        findings.push(finding(ctx, ['paths', key], 'openapi/path-prefix', 'error',
          `"${key}" is not a valid path; OpenAPI path keys must start with "/"`));
      }
      const pathItem = data.paths[key];
      if (!isObject(pathItem)) continue;
      for (const [opKey, op] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(opKey)) continue;
        if (!isObject(op)) {
          findings.push(finding(ctx, ['paths', key, opKey], 'openapi/operation-shape', 'warning',
            `${opKey.toUpperCase()} ${key} operation must be an object`));
          continue;
        }
        if (!isObject(op.responses)) {
          findings.push(finding(ctx, ['paths', key, opKey, 'responses'], 'openapi/operation-shape', 'warning',
            `${opKey.toUpperCase()} ${key} operation is missing "responses"`));
        }
      }
    }
  }

  findings.push(...emitRemoteRefFindings(ctx, 'openapi'));
  return findings;
}
