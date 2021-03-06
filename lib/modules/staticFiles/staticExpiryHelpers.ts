/**
 * This file contains helper functions that wrap the functionality in the
 * static-expiry module to make it more suitable for our needs.
 */
import { Handler } from "express";
import { fingerprintUrl as furl } from "../urlFor";
import url = require("url");
import path = require("path");
import express = require("express");
import expiry = require("static-expiry");

/**
 * Generates an array of middleware used to serve static files, and a function
 * to generate fingerprinted urls. These middleware and function may be used,
 * or may be replaced with user provided ones.
 *
 * @param {string} mountPath The static files' mount path from the global config.
 * @param {string} staticFilesPath The static files' path on disk from the global config.
 */
export function makeServingMiddlewareAndFurl(mountPath: string, staticFilesPath: string): [Handler[], furl] {
  const oneYearInSeconds = (60 * 60 * 24 * 365); // tslint:disable-line
  const oneYearInMilliseconds = oneYearInSeconds*1000; // tslint:disable-line

  const staticExpiryOpts: expiry.config = {
    location: 'query',
    loadCache: 'startup',

    // The whole point of fingerprinted urls is that you can always
    // safely use caching headers, even in development, so let's do that.
    unconditional: "both",
    conditional: "both",
    duration: oneYearInSeconds,

    // static-expiry is kinda naive about how it generates cache keys.
    // In particular, it just takes the absolute path to the file and
    // strips off the first options.dir.length characters. So, if we provide
    // a dir option ending with a `/` we get a different cache key than if
    // we don't. So, below, we normalize the dir we pass in to always end
    // without a slash, so that the cache key always starts with a slash.
    dir: staticFilesPath.replace(/\/$/, '')
  };

  // We need to create the middleware below before reading app.locals.furl,
  // because expiry actually adds the furl function as a side effect. Annoying.
  const staticExpiryMiddleware = expiry(null, staticExpiryOpts);
  const middlewares = [
    staticExpiryMiddleware,
    express.static(staticFilesPath, { maxAge: oneYearInMilliseconds, index: false })
  ];

  const furl = mountPathAwareFurl(mountPath, staticExpiryMiddleware.furl);

  return [middlewares, furl];
}

/**
 * Looks up the fingerprint for a file -- ONLY applies when static expiry
 * is being used to generate the fingerprints (hence its place in this file).
 *
 * @param {string} relativeFilePath A path to the file relative to the
 *   static files mount path.
 */
export function getFingerprintForFile(relativeFilePath: string) {
  const fileCacheKey = path.resolve("/", relativeFilePath);
  const origFingerprintedUrl = (<expiryReal>(<any>expiry)).urlCache[fileCacheKey];

  if(origFingerprintedUrl === undefined) {
    throw new Error("Fingerprint could not be found for file: " + relativeFilePath);
  }

  return url.parse(origFingerprintedUrl, true).query.v;
}

/**
 * furl doesn't understand the concept of a static files mount path, because
 * static-expiry is built for connect, and a mount path is an abstraction added
 * at the express level. So here we create a function that strips the mount path
 * from the start of the url (if present) before invoking static-expiry's furl.
 */
function mountPathAwareFurl(mountPath: string, furl: furl): furl {
  const mountPathWithTrailingSlash = mountPath.replace(/\/$/, "") + "/";

  // If mountPath is the string '/', that should behave identically to mountPath
  // being the empty string. However, looking at the return value below, you can
  // see that it might not, because: `'/' + furl(path.substr(1))` may not equal
  // `'' + furl(path.substr(0))`, which is just `furl(path)`. Now, in practice,
  // those two values are actually equal, because of how furl happens to be
  // implemented. But we don't want to rely on that, so  we normalize
  // mountPath === '/' to '' in this case. With this normalization, mountPath
  // is either /dirname or an empty string, and, either way, we end up feeding
  // a path into furl with a leading '/', which is good.
  if(mountPath === '/') {
    mountPath = '';
  }

  // Remove the mount path if any [sometimes there is none for static files]
  // before furling, and then add it back afterwards.
  return (path) => {
    if(!path.startsWith(mountPathWithTrailingSlash)) {
      throw new UrlToFingerprintNotUnderMountPathError(path, mountPath);
    }

    return mountPath + furl(path.substr(mountPath.length));
  }
}

export class UrlToFingerprintNotUnderMountPathError extends Error {
  constructor(path: string, mountPath: string) {
    super(
      `You tried to fingerprint a url (${path}) whose path isn\'t under the` +
      `static files mount path (${mountPath}). However, when using the built-in ` +
      'fingerprint function, only urls for static files can be fingerprinted, ' +
      'and all static files have their URL under the static files mount path. ' +
      'Note: urlFor\'s `fingerprint` option defaults to true, so you may just ' +
      'have forgotten to explicitly set it to false.'
    );
  }
};

// We sometimes need to peek into the caches that are really
// part of the private expiry api, so I document them here.
type expiryReal = {
  urlCache: { [plainUrl: string]: string };
  assetCache: {
    [fingerprintedUrl: string]:
      { assetUrl: string, lastModified: string, etag: string }
  }
}
