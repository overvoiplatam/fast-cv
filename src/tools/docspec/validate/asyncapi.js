import { isObject, finding, emitRemoteRefFindings } from './common.js';
import { isAsyncApiVersion } from '../version.js';

export function validateAsyncapi(ctx) {
  const findings = [];
  const { data } = ctx;

  if (!isAsyncApiVersion(data.asyncapi)) {
    findings.push(finding(ctx, ['asyncapi'], 'asyncapi/version-format', 'error',
      `asyncapi field must be a 2.x or 3.x semver string; got ${JSON.stringify(data.asyncapi)}`));
  }

  if (!isObject(data.info) || typeof data.info.title !== 'string' || typeof data.info.version !== 'string') {
    findings.push(finding(ctx, ['info'], 'asyncapi/info-required', 'error',
      'info.title and info.version are required string fields'));
  }

  const major = parseInt((data.asyncapi || '').split('.')[0], 10);
  const hasChannels = isObject(data.channels);
  const hasOperations = isObject(data.operations);
  if (!hasChannels && !(major >= 3 && hasOperations)) {
    findings.push(finding(ctx, ['channels'], 'asyncapi/channels-required', 'error',
      'channels must be an object (AsyncAPI 3.x may use operations instead)'));
  }

  findings.push(...emitRemoteRefFindings(ctx, 'asyncapi'));
  return findings;
}
