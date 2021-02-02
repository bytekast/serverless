'use strict';

const _ = require('lodash');
const memoize = require('memoizee');
const PromiseQueue = require('promise-queue');
const sdk = require('aws-sdk');
const chalk = require('chalk');
const ServerlessError = require('../../../../lib/serverless-error');
const log = require('@serverless/utils/log');
const HttpsProxyAgent = require('https-proxy-agent');
const https = require('https');
const fs = require('fs');

// Activate AWS SDK logging
if (process.env.SLS_DEBUG) {
  sdk.config.logger = log;
}

// Use HTTPS Proxy (Optional)
const proxy =
  process.env.proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  process.env.HTTPS_PROXY ||
  process.env.https_proxy;

const proxyOptions = {};
if (proxy) {
  Object.assign(proxyOptions, new URL(proxy));
}

const ca = process.env.ca || process.env.HTTPS_CA || process.env.https_ca;

let caCerts = [];

if (ca) {
  // Can be a single certificate or multiple, comma separated.
  const caArr = ca.split(',');
  // Replace the newline -- https://stackoverflow.com/questions/30400341
  caCerts = caCerts.concat(caArr.map((cert) => cert.replace(/\\n/g, '\n')));
}

const cafile = process.env.cafile || process.env.HTTPS_CAFILE || process.env.https_cafile;

if (cafile) {
  // Can be a single certificate file path or multiple paths, comma separated.
  const caPathArr = cafile.split(',');
  caCerts = caCerts.concat(caPathArr.map((cafilePath) => fs.readFileSync(cafilePath.trim())));
}

if (caCerts.length > 0) {
  Object.assign(proxyOptions, {
    rejectUnauthorized: true,
    ca: caCerts,
  });
}

// Passes also certifications
if (proxy) {
  sdk.config.httpOptions.agent = new HttpsProxyAgent(proxyOptions);
} else if (proxyOptions.ca) {
  // Update the agent -- http://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/node-registering-certs.html
  sdk.config.httpOptions.agent = new https.Agent(proxyOptions);
}

// Configure the AWS Client timeout (Optional).  The default is 120000 (2 minutes)
const timeout = process.env.AWS_CLIENT_TIMEOUT || process.env.aws_client_timeout;
if (timeout) {
  sdk.config.httpOptions.timeout = parseInt(timeout, 10);
}
PromiseQueue.configure(Promise);
const requestQueue = new PromiseQueue(2, Infinity);

const MAX_RETRIES = (() => {
  const userValue = Number(process.env.SLS_AWS_REQUEST_MAX_RETRIES);
  return userValue >= 0 ? userValue : 4;
})();

function awsRequest(service, method, params = {}, serviceOptions = {}) {
  // Checks regarding expectations on serviceOptions
  if (!_.isObject(serviceOptions) || !_.isObject(serviceOptions.credentials)) {
    return Promise.reject(
      new ServerlessError(
        'Inappropriate call of awsRequest(), missing credentials in serviceOptions',
        400
      )
    );
  }

  const BASE_BACKOFF = 5000;
  const persistentRequest = (f) =>
    new Promise((resolve, reject) => {
      const doCall = (numTry) => {
        f()
          // We're resembling if/else logic, therefore single `then` instead of `then`/`catch` pair
          .then(resolve, (e) => {
            const { providerError } = e;
            if (
              numTry < MAX_RETRIES &&
              providerError &&
              ((providerError.retryable &&
                providerError.statusCode !== 403 &&
                providerError.code !== 'CredentialsError') ||
                providerError.statusCode === 429)
            ) {
              const nextTryNum = numTry + 1;
              const jitter = Math.random() * 3000 - 1000;
              // backoff is between 4 and 7 seconds
              const backOff = BASE_BACKOFF + jitter;

              log(
                [
                  `Recoverable error occurred (${e.message}), sleeping for ~${Math.round(
                    backOff / 1000
                  )} seconds.`,
                  `Try ${nextTryNum} of ${MAX_RETRIES}`,
                ].join(' ')
              );
              setTimeout(doCall, backOff, nextTryNum);
            } else {
              reject(e);
            }
          });
      };
      return doCall(0);
    });

  // Support S3 Transfer Acceleration
  if (
    service === 'S3' &&
    ['upload', 'putObject'].indexOf(method) !== -1 &&
    serviceOptions.isS3TransferAccelerationEnabled
  ) {
    log('Using S3 Transfer Acceleration Endpoint...');
    serviceOptions.credentials.useAccelerateEndpoint = true; // eslint-disable-line no-param-reassign
  }

  const request = requestQueue.add(() =>
    persistentRequest(() => {
      const Service = _.get(sdk, service);
      serviceOptions.credentials.region = serviceOptions.region;
      const awsService = new Service(serviceOptions.credentials);
      const req = awsService[method](params);

      // TODO: Add listeners, put Debug statements here...
      // req.on('send', function (r) {console.log(r)});
      const promise = req.promise();
      return promise.catch((err) => {
        let message = err.message != null ? err.message : String(err.code);
        if (message.startsWith('Missing credentials in config')) {
          // Credentials error
          // If failed at last resort (EC2 Metadata check) expose a meaningful error
          // with link to AWS documentation
          // Otherwise, it's likely that user relied on some AWS creds, which appeared not correct
          // therefore expose an AWS message directly
          let bottomError = err;
          while (bottomError.originalError && !bottomError.message.startsWith('EC2 Metadata')) {
            bottomError = bottomError.originalError;
          }

          const errorMessage = bottomError.message.startsWith('EC2 Metadata')
            ? [
                'AWS provider credentials not found.',
                ' Learn how to set up AWS provider credentials',
                ` in our docs here: <${chalk.green('http://slss.io/aws-creds-setup')}>.`,
              ].join('')
            : bottomError.message;
          message = errorMessage;
          // We do not want to trigger the retry mechanism for credential errors
          return Promise.reject(
            Object.assign(new ServerlessError(errorMessage, err.code), {
              providerError: Object.assign({}, err, { retryable: false }),
            })
          );
        }

        return Promise.reject(
          Object.assign(new ServerlessError(message, err.code), {
            providerError: err,
          })
        );
      });
    }).then((data) => {
      const result = Promise.resolve(data);
      return result;
    })
  );

  return request;
}

awsRequest.memoized = memoize(awsRequest);

module.exports = awsRequest;
