import { basename } from 'node:path';
import { isOpenApiVersion, isAsyncApiVersion, isSwaggerStringVersion } from './version.js';

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function classify(doc, filename) {
  if (!isObject(doc)) return null;

  if (typeof doc.openapi === 'string' && isOpenApiVersion(doc.openapi) && isObject(doc.info)) {
    return 'openapi';
  }
  const swaggerIsStringVersion = typeof doc.swagger === 'string' && isSwaggerStringVersion(doc.swagger);
  if ((doc.swagger === 2 || swaggerIsStringVersion) && isObject(doc.info)) {
    return 'swagger';
  }
  if (typeof doc.asyncapi === 'string' && isAsyncApiVersion(doc.asyncapi) && isObject(doc.info)) {
    return 'asyncapi';
  }
  if (typeof doc.$schema === 'string') {
    return 'jsonschema';
  }
  if (filename && /\.schema\.json$/i.test(basename(filename))) {
    if ('type' in doc || 'properties' in doc || '$ref' in doc) return 'jsonschema';
  }
  return null;
}
