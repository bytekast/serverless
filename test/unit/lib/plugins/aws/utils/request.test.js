'use strict';

const sinon = require('sinon');
const chai = require('chai');
const proxyquire = require('proxyquire');
const BbPromise = require('bluebird');

const expect = chai.expect;

chai.use(require('chai-as-promised'));
chai.use(require('sinon-chai'));

describe('#request', () => {
  before(() => {
    const originalSetTimeout = setTimeout;
    sinon
      .stub(global, 'setTimeout')
      .callsFake((cb, timeout) => originalSetTimeout(cb, Math.min(timeout || 0, 10)));
  });

  after(() => {
    sinon.restore();
  });

  it('shoud fail with a meaningful error when credentials are missing', () => {
    const awsRequest = require('../../../../../../lib/plugins/aws/utils/request');
    expect(awsRequest('S3', 'putObject', {})).to.eventually.be.rejectedWith(
      'Inappropriate call of awsRequest(), missing credentials in serviceOptions'
    );
  });

  it('should trigger the expected AWS SDK invokation', () => {
    // mocking S3 for testing
    //
    class FakeS3 {
      constructor(credentials) {
        this.credentials = credentials;
      }

      putObject() {
        return {
          send: (cb) => cb(null, { called: true }),
        };
      }
    }
    const awsRequest = proxyquire('../../../../../../lib/plugins/aws/utils/request', {
      'aws-sdk': { S3: FakeS3 },
    });
    return awsRequest('S3', 'putObject', {}, { credentials: {} }).then((data) => {
      expect(data.called).to.equal(true);
    });
  });

  it('should handle subclasses', () => {
    class DocumentClient {
      constructor(credentials) {
        this.credentials = credentials;
      }

      put() {
        return {
          send: (cb) => cb(null, { called: true }),
        };
      }
    }

    const awsRequest = proxyquire('../../../../../../lib/plugins/aws/utils/request', {
      'aws-sdk': { DynamoDB: { DocumentClient } },
    });

    return awsRequest('DynamoDB.DocumentClient', 'put', {}, { credentials: {} }).then((data) => {
      expect(data.called).to.equal(true);
    });
  });

  it('should request to the specified region if region in options set', () => {
    // mocking CloudFormation for testing
    class FakeCloudFormation {
      constructor(config) {
        this.config = config;
      }

      describeStacks() {
        return {
          send: (cb) =>
            cb(null, {
              region: this.config.region,
            }),
        };
      }
    }

    const awsRequest = proxyquire('../../../../../../lib/plugins/aws/utils/request', {
      'aws-sdk': { CloudFormation: FakeCloudFormation },
    });
    return awsRequest(
      'CloudFormation',
      'describeStacks',
      { StackName: 'foo' },
      { credentials: {}, region: 'ap-northeast-1' }
    ).then((data) => {
      expect(data).to.eql({ region: 'ap-northeast-1' });
    });
  });

  it('should retry on retryable errors (429)', (done) => {
    const error = {
      statusCode: 429,
      retryable: true,
      message: 'Testing retry',
    };
    const sendFake = {
      send: sinon.stub(),
    };
    sendFake.send.onFirstCall().yields(error);
    sendFake.send.yields(undefined, {});
    class FakeS3 {
      constructor(credentials) {
        this.credentials = credentials;
      }

      error() {
        return sendFake;
      }
    }

    const awsRequest = proxyquire('../../../../../../lib/plugins/aws/utils/request', {
      'aws-sdk': { S3: FakeS3 },
    });

    awsRequest('S3', 'error', {}, { credentials: {} })
      .then((data) => {
        expect(data).to.exist;
        expect(sendFake.send).to.have.been.calledTwice;
        done();
      })
      .catch(done);
  });

  it('should retry if error code is 429 and retryable is set to false', (done) => {
    const error = {
      statusCode: 429,
      retryable: false,
      message: 'Testing retry',
    };
    const sendFake = {
      send: sinon.stub(),
    };
    sendFake.send.onFirstCall().yields(error);
    sendFake.send.yields(undefined, {});
    class FakeS3 {
      constructor(credentials) {
        this.credentials = credentials;
      }

      error() {
        return sendFake;
      }
    }

    const awsRequest = proxyquire('../../../../../../lib/plugins/aws/utils/request', {
      'aws-sdk': { S3: FakeS3 },
    });

    awsRequest('S3', 'error', {}, { credentials: {} })
      .then((data) => {
        expect(data).to.exist;
        expect(sendFake.send).to.have.been.calledTwice;
        done();
      })
      .catch(done);
  });

  it('should not retry if error code is 403 and retryable is set to true', (done) => {
    const error = {
      statusCode: 403,
      retryable: true,
      message: 'Testing retry',
    };
    const sendFake = {
      send: sinon.stub(),
    };
    sendFake.send.onFirstCall().yields(error);
    sendFake.send.yields(undefined, {});
    class FakeS3 {
      constructor(credentials) {
        this.credentials = credentials;
      }

      error() {
        return sendFake;
      }
    }
    const awsRequest = proxyquire('../../../../../../lib/plugins/aws/utils/request', {
      'aws-sdk': { S3: FakeS3 },
    });

    awsRequest('S3', 'error', {}, { credentials: {} })
      .then(() => done('Should not succeed'))
      .catch(() => {
        expect(sendFake.send).to.have.been.calledOnce;
        done();
      });
  });

  it('should expose non-retryable errors', (done) => {
    const error = {
      statusCode: 500,
      message: 'Some error message',
    };
    class FakeS3 {
      constructor(credentials) {
        this.credentials = credentials;
      }

      error() {
        return {
          send(cb) {
            cb(error);
          },
        };
      }
    }

    const awsRequest = proxyquire('../../../../../../lib/plugins/aws/utils/request', {
      'aws-sdk': { S3: FakeS3 },
    });

    awsRequest('S3', 'error', {}, { credentials: {} })
      .then(() => done('Should not succeed'))
      .catch(() => done());
  });

  it('should expose original error message in thrown error message', (done) => {
    const awsErrorResponse = {
      message: 'Something went wrong...',
      code: 'Forbidden',
      region: null,
      time: '2019-01-24T00:29:01.780Z',
      requestId: 'DAF12C1111A62C6',
      extendedRequestId: '1OnSExiLCOsKrsdjjyds31w=',
      statusCode: 403,
      retryable: false,
      retryDelay: 13.433158364430508,
    };

    class FakeS3 {
      constructor(credentials) {
        this.credentials = credentials;
      }

      error() {
        return {
          send(cb) {
            cb(awsErrorResponse);
          },
        };
      }
    }

    const awsRequest = proxyquire('../../../../../../lib/plugins/aws/utils/request', {
      'aws-sdk': { S3: FakeS3 },
    });

    awsRequest('S3', 'error', {}, { credentials: {} })
      .then(() => done('Should not succeed'))
      .catch((err) => {
        expect(err.message).to.equal(awsErrorResponse.message);
        done();
      })
      .catch(done);
  });

  it('should default to error code if error message is non-existent', (done) => {
    const awsErrorResponse = {
      message: null,
      code: 'Forbidden',
      region: null,
      time: '2019-01-24T00:29:01.780Z',
      requestId: 'DAF12C1111A62C6',
      extendedRequestId: '1OnSExiLCOsKrsdjjyds31w=',
      statusCode: 403,
      retryable: false,
      retryDelay: 13.433158364430508,
    };

    class FakeS3 {
      constructor(credentials) {
        this.credentials = credentials;
      }

      error() {
        return {
          send(cb) {
            cb(awsErrorResponse);
          },
        };
      }
    }

    const awsRequest = proxyquire('../../../../../../lib/plugins/aws/utils/request', {
      'aws-sdk': { S3: FakeS3 },
    });

    awsRequest('S3', 'error', {}, { credentials: {} })
      .then(() => done('Should not succeed'))
      .catch((err) => {
        expect(err.message).to.equal(awsErrorResponse.code);
        done();
      })
      .catch(done);
  });

  it('should return ref to docs for missing credentials', (done) => {
    const error = {
      statusCode: 403,
      message: 'Missing credentials in config',
      originalError: { message: 'EC2 Metadata roleName request returned error' },
    };
    class FakeS3 {
      constructor(credentials) {
        this.credentials = credentials;
      }

      error() {
        return {
          send(cb) {
            cb(error);
          },
        };
      }
    }

    const awsRequest = proxyquire('../../../../../../lib/plugins/aws/utils/request', {
      'aws-sdk': { S3: FakeS3 },
    });

    awsRequest('S3', 'error', {}, { credentials: {} })
      .then(() => done('Should not succeed'))
      .catch((err) => {
        expect(err.message).to.contain('in our docs here:');
        done();
      })
      .catch(done);
  });

  it('should enable S3 acceleration if "--aws-s3-accelerate" CLI option is provided', () => {
    // mocking S3 for testing
    class FakeS3 {
      constructor(credentials) {
        this.credentials = credentials;
      }

      putObject() {
        return {
          send: (cb) => cb(null, { called: true }),
        };
      }
    }

    const awsRequest = proxyquire('../../../../../../lib/plugins/aws/utils/request', {
      'aws-sdk': { S3: FakeS3 },
    });

    const credentials = {
      useAccelerateEndpoint: false,
    };

    return awsRequest(
      'S3',
      'putObject',
      {},
      { credentials, isS3TransferAccelerationEnabled: true }
    ).then(() => {
      // those credentials are passed to the service constructor
      expect(credentials.useAccelerateEndpoint).to.equal(true);
    });
  });

  describe('Caching through memoize', () => {
    it('should reuse the result if arguments are the same', (done) => {
      // mocking CF for testing
      const expectedResult = { called: true };
      const sendStub = sinon.stub().yields(null, { called: true });
      class FakeCF {
        constructor(credentials) {
          this.credentials = credentials;
        }

        describeStacks() {
          return {
            send: sendStub,
          };
        }
      }
      const awsRequest = proxyquire('../../../../../../lib/plugins/aws/utils/request', {
        'aws-sdk': { CloudFormation: FakeCF },
      });

      const numTests = 100;
      const executeRequest = () =>
        awsRequest.memoized(
          'CloudFormation',
          'describeStacks',
          {},
          { credentials: {}, useCache: true }
        );
      const requests = [];
      for (let n = 0; n < numTests; n++) {
        requests.push(BbPromise.try(() => executeRequest()));
      }

      BbPromise.all(requests).then((results) => {
        expect(Object.keys(results).length).to.equal(numTests);
        results.forEach((result) => {
          expect(result).to.deep.equal(expectedResult);
        });
        expect(sendStub).to.have.been.calledOnce;
        done();
      });
    });

    it('should not reuse the result if the region change', () => {
      const expectedResult = { called: true };
      const sendStub = sinon.stub().yields(null, { called: true });
      class FakeCF {
        constructor(credentials) {
          this.credentials = credentials;
        }

        describeStacks() {
          return {
            send: sendStub,
          };
        }
      }

      const awsRequest = proxyquire('../../../../../../lib/plugins/aws/utils/request', {
        'aws-sdk': { CloudFormation: FakeCF },
      });

      const executeRequestWithRegion = (region) =>
        awsRequest(
          'CloudFormation',
          'describeStacks',
          { StackName: 'same-stack' },
          {
            region,
            credentials: {},
          }
        );
      const requests = [];
      requests.push(BbPromise.try(() => executeRequestWithRegion('us-east-1')));
      requests.push(BbPromise.try(() => executeRequestWithRegion('ap-northeast-1')));

      return BbPromise.all(requests).then((results) => {
        expect(Object.keys(results).length).to.equal(2);
        results.forEach((result) => {
          expect(result).to.deep.equal(expectedResult);
        });
        return expect(sendStub.callCount).to.equal(2);
      });
    });
  });
});
