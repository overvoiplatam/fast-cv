import { basename } from 'node:path';
import { isOpenApiVersion, isAsyncApiVersion, isSwaggerStringVersion } from './version.js';

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function classify(doc, filename) {
  if (!isObject(doc)) return null;
  if (looksLikeOpenapi(doc)) return 'openapi';
  if (looksLikeSwagger(doc)) return 'swagger';
  if (looksLikeAsyncapi(doc)) return 'asyncapi';
  if (looksLikeJsonSchema(doc, filename)) return 'jsonschema';
  return null;
}

function looksLikeOpenapi(doc) {
  return typeof doc.openapi === 'string'
    && isOpenApiVersion(doc.openapi)
    && isObject(doc.info);
}

function looksLikeSwagger(doc) {
  const stringVersion = typeof doc.swagger === 'string'
    && isSwaggerStringVersion(doc.swagger);
  return (doc.swagger === 2 || stringVersion) && isObject(doc.info);
}

function looksLikeAsyncapi(doc) {
  return typeof doc.asyncapi === 'string'
    && isAsyncApiVersion(doc.asyncapi)
    && isObject(doc.info);
}

function looksLikeJsonSchema(doc, filename) {
  if (typeof doc.$schema === 'string') return true;
  if (!filename) return false;
  if (!/\.schema\.json$/i.test(basename(filename))) return false;
  return 'type' in doc || 'properties' in doc || '$ref' in doc;
}
