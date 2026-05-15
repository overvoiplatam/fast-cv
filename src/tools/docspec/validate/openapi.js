import { isObject, finding, emitRemoteRefFindings } from './common.js';
import { isOpenApiVersion } from '../version.js';

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

export function validateOpenapi(ctx) {
  return [
    ...validateVersion(ctx),
    ...validateInfo(ctx),
    ...validatePathsContainer(ctx),
    ...emitRemoteRefFindings(ctx, 'openapi'),
  ];
}

function validateVersion(ctx) {
  if (isOpenApiVersion(ctx.data.openapi)) return [];
  return [finding(ctx, ['openapi'], 'openapi/version-format', 'error',
    `openapi field must be a semver string like "3.0.0"; got ${JSON.stringify(ctx.data.openapi)}`)];
}

function validateInfo(ctx) {
  const info = ctx.data.info;
  if (isObject(info) && typeof info.title === 'string' && typeof info.version === 'string') return [];
  return [finding(ctx, ['info'], 'openapi/info-required', 'error',
    'info.title and info.version are required string fields')];
}

function validatePathsContainer(ctx) {
  const { data } = ctx;
  if (isObject(data.paths)) return validatePathsObject(ctx, data.paths);
  if (alternativesAllowed(data) && hasAlternativeContainer(data)) return [];
  return [finding(ctx, ['paths'], 'openapi/paths-required', 'error',
    'paths must be an object (OpenAPI 3.1 allows webhooks or components as alternatives)')];
}

function alternativesAllowed(data) {
  const major = parseInt((data.openapi || '').split('.').at(0), 10);
  const minor = parseInt((data.openapi || '').split('.').at(1), 10);
  return major === 3 && minor >= 1;
}

function hasAlternativeContainer(data) {
  return isObject(data.webhooks) || isObject(data.components);
}

function validatePathsObject(ctx, paths) {
  const findings = [];
  for (const [key, pathItem] of Object.entries(paths)) {
    if (key.startsWith('x-')) continue;
    if (!key.startsWith('/')) {
      findings.push(finding(ctx, ['paths', key], 'openapi/path-prefix', 'error',
        `"${key}" is not a valid path; OpenAPI path keys must start with "/"`));
    }
    if (!isObject(pathItem)) continue;
    findings.push(...validatePathOperations(ctx, key, pathItem));
  }
  return findings;
}

function validatePathOperations(ctx, pathKey, pathItem) {
  const findings = [];
  for (const [opKey, op] of Object.entries(pathItem)) {
    if (!HTTP_METHODS.has(opKey)) continue;
    findings.push(...validateOperation(ctx, pathKey, opKey, op));
  }
  return findings;
}

function validateOperation(ctx, pathKey, opKey, op) {
  if (!isObject(op)) {
    return [finding(ctx, ['paths', pathKey, opKey], 'openapi/operation-shape', 'warning',
      `${opKey.toUpperCase()} ${pathKey} operation must be an object`)];
  }
  if (!isObject(op.responses)) {
    return [finding(ctx, ['paths', pathKey, opKey, 'responses'], 'openapi/operation-shape', 'warning',
      `${opKey.toUpperCase()} ${pathKey} operation is missing "responses"`)];
  }
  return [];
}
