import { isObject, finding } from './common.js';

export function validateSwagger(ctx) {
  const findings = [];
  const { data } = ctx;

  if (data.swagger !== '2.0') {
    findings.push(finding(ctx, ['swagger'], 'swagger/version', 'error',
      `swagger field must be exactly "2.0"; got ${JSON.stringify(data.swagger)}`));
  }

  if (!isObject(data.info) || typeof data.info.title !== 'string' || typeof data.info.version !== 'string') {
    findings.push(finding(ctx, ['info'], 'swagger/info-required', 'error',
      'info.title and info.version are required string fields'));
  }

  const hasPaths = isObject(data.paths) && Object.keys(data.paths).length > 0;
  const hasDefs = isObject(data.definitions) && Object.keys(data.definitions).length > 0;
  if (!hasPaths && !hasDefs) {
    findings.push(finding(ctx, ['paths'], 'swagger/paths-required', 'error',
      'Swagger 2.0 docs must declare at least one path or definition'));
  }

  if (typeof data.basePath === 'string' && data.basePath && !data.basePath.startsWith('/')) {
    findings.push(finding(ctx, ['basePath'], 'swagger/basepath', 'warning',
      `basePath should start with "/"; got ${JSON.stringify(data.basePath)}`));
  }

  return findings;
}
