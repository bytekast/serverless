'use strict';

/* eslint-disable no-unused-expressions */

const sinon = require('sinon');
const chai = require('chai');
const proxyquire = require('proxyquire').noCallThru();
const AwsProvider = require('../../../../provider/awsProvider');
const Serverless = require('../../../../../../Serverless');
const runServerless = require('../../../../../../../test/utils/run-serverless');

chai.use(require('sinon-chai'));
chai.use(require('chai-as-promised'));

const { expect } = chai;

describe('AwsCompileEventBridgeEvents', () => {
  let serverless;
  let awsCompileEventBridgeEvents;
  let addCustomResourceToServiceStub;

  beforeEach(() => {
    addCustomResourceToServiceStub = sinon.stub().resolves();
    const AwsCompileEventBridgeEvents = proxyquire('./index', {
      '../../../../customResources': {
        addCustomResourceToService: addCustomResourceToServiceStub,
      },
    });
    serverless = new Serverless();
    serverless.service.provider.compiledCloudFormationTemplate = { Resources: {} };
    serverless.setProvider('aws', new AwsProvider(serverless));
    awsCompileEventBridgeEvents = new AwsCompileEventBridgeEvents(serverless);

    awsCompileEventBridgeEvents.serverless.service.service = 'new-service';
  });

  describe('#constructor()', () => {
    it('should set the provider variable to an instance of AwsProvider', () =>
      expect(awsCompileEventBridgeEvents.provider).to.be.instanceof(AwsProvider));
  });

  describe('#compileEventBridgeEvents()', () => {
    describe('when using native CloudFormation', () => {
      it('should create the necessary resources for the most minimal configuration', () => {
        awsCompileEventBridgeEvents.serverless.service.provider.eventBridge = {
          useCloudFormation: true,
        };
        awsCompileEventBridgeEvents.serverless.service.functions = {
          first: {
            name: 'first',
            events: [
              {
                eventBridge: {
                  schedule: 'rate(10 minutes)',
                  pattern: {
                    'source': ['aws.cloudformation'],
                    'detail-type': ['AWS API Call via CloudTrail'],
                    'detail': {
                      eventSource: ['cloudformation.amazonaws.com'],
                    },
                  },
                },
              },
            ],
          },
        };

        awsCompileEventBridgeEvents.compileEventBridgeEvents();
        const {
          Resources,
        } = awsCompileEventBridgeEvents.serverless.service.provider.compiledCloudFormationTemplate;

        expect(addCustomResourceToServiceStub).not.to.have.been.called;
        expect(Resources).to.deep.equal({
          FirstEventBridgeLambdaPermission1: {
            Type: 'AWS::Lambda::Permission',
            Properties: {
              Action: 'lambda:InvokeFunction',
              FunctionName: {
                Ref: 'FirstLambdaFunction',
              },
              Principal: 'events.amazonaws.com',
              SourceArn: {
                'Fn::Join': [
                  ':',
                  [
                    'arn',
                    { Ref: 'AWS::Partition' },
                    'events',
                    { Ref: 'AWS::Region' },
                    { Ref: 'AWS::AccountId' },
                    {
                      'Fn::Join': ['/', ['rule', 'first-rule-1']],
                    },
                  ],
                ],
              },
            },
          },
          Firstrule1EventBridgeRule: {
            Type: 'AWS::Events::Rule',
            Properties: {
              EventBusName: undefined,
              EventPattern:
                '{"source":["aws.cloudformation"],"detail-type":["AWS API Call via CloudTrail"],"detail":{"eventSource":["cloudformation.amazonaws.com"]}}',
              Name: 'first-rule-1',
              ScheduleExpression: 'rate(10 minutes)',
              State: 'ENABLED',
              Targets: [
                {
                  Arn: {
                    'Fn::GetAtt': ['FirstLambdaFunction', 'Arn'],
                  },
                  Id: 'first-rule-1-target',
                },
              ],
            },
          },
        });
      });

      it('should shorten the rule name if it exceeds 64 chars', () => {
        awsCompileEventBridgeEvents.serverless.service.provider.eventBridge = {
          useCloudFormation: true,
        };
        awsCompileEventBridgeEvents.serverless.service.functions = {
          oneVeryLongAndVeryStrangeAndVeryComplicatedFunctionNameOver64Chars: {
            name: 'one-very-long-and-very-strange-and-very-complicated-function-name-over-64-chars',
            events: [
              {
                eventBridge: {
                  schedule: 'rate(10 minutes)',
                  pattern: {
                    'source': ['aws.cloudformation'],
                    'detail-type': ['AWS API Call via CloudTrail'],
                    'detail': {
                      eventSource: ['cloudformation.amazonaws.com'],
                    },
                  },
                },
              },
            ],
          },
        };

        awsCompileEventBridgeEvents.compileEventBridgeEvents();
        const {
          Resources,
        } = awsCompileEventBridgeEvents.serverless.service.provider.compiledCloudFormationTemplate;
        const RuleNameFromResource =
          Resources
            .Oneverylongandverystrangeandverycomplicatedfunctionnameover64charsrule1EventBridgeRule
            .Properties.Name;
        expect(RuleNameFromResource.endsWith('rule-1')).to.be.true;
        expect(RuleNameFromResource).lengthOf.lte(64);
      });

      it('should create the necessary resources when using a complex configuration', () => {
        awsCompileEventBridgeEvents.serverless.service.provider.eventBridge = {
          useCloudFormation: true,
        };
        awsCompileEventBridgeEvents.serverless.service.functions = {
          first: {
            name: 'first',
            events: [
              {
                eventBridge: {
                  eventBus: 'some-event-bus',
                  schedule: 'rate(10 minutes)',
                  pattern: {
                    'source': ['aws.cloudformation'],
                    'detail-type': ['AWS API Call via CloudTrail'],
                    'detail': {
                      eventSource: ['cloudformation.amazonaws.com'],
                    },
                  },
                  input: {
                    key1: 'value1',
                    key2: {
                      nested: 'value2',
                    },
                  },
                },
              },
            ],
          },
        };

        awsCompileEventBridgeEvents.compileEventBridgeEvents();
        const {
          Resources,
        } = awsCompileEventBridgeEvents.serverless.service.provider.compiledCloudFormationTemplate;

        expect(Resources).to.deep.equal({
          SomeDasheventDashbusEventBridgeEventBus: {
            Type: 'AWS::Events::EventBus',
            Properties: {
              Name: 'some-event-bus',
            },
          },
          FirstEventBridgeLambdaPermission1: {
            Type: 'AWS::Lambda::Permission',
            Properties: {
              Action: 'lambda:InvokeFunction',
              FunctionName: {
                Ref: 'FirstLambdaFunction',
              },
              Principal: 'events.amazonaws.com',
              SourceArn: {
                'Fn::Join': [
                  ':',
                  [
                    'arn',
                    { Ref: 'AWS::Partition' },
                    'events',
                    { Ref: 'AWS::Region' },
                    { Ref: 'AWS::AccountId' },
                    {
                      'Fn::Join': ['/', ['rule', 'some-event-bus', 'first-rule-1']],
                    },
                  ],
                ],
              },
            },
          },
          Firstrule1EventBridgeRule: {
            Type: 'AWS::Events::Rule',
            Properties: {
              EventBusName: 'some-event-bus',
              EventPattern:
                '{"source":["aws.cloudformation"],"detail-type":["AWS API Call via CloudTrail"],"detail":{"eventSource":["cloudformation.amazonaws.com"]}}',
              Name: 'first-rule-1',
              ScheduleExpression: 'rate(10 minutes)',
              State: 'ENABLED',
              Targets: [
                {
                  Arn: {
                    'Fn::GetAtt': ['FirstLambdaFunction', 'Arn'],
                  },
                  Id: 'first-rule-1-target',
                  Input: '{"key1":"value1","key2":{"nested":"value2"}}',
                },
              ],
            },
            DependsOn: 'SomeDasheventDashbusEventBridgeEventBus',
          },
        });
      });

      it('should create the necessary resources when using an input configuration', () => {
        awsCompileEventBridgeEvents.serverless.service.provider.eventBridge = {
          useCloudFormation: true,
        };
        awsCompileEventBridgeEvents.serverless.service.functions = {
          first: {
            name: 'first',
            events: [
              {
                eventBridge: {
                  pattern: {
                    'source': ['aws.cloudformation'],
                    'detail-type': ['AWS API Call via CloudTrail'],
                    'detail': {
                      eventSource: ['cloudformation.amazonaws.com'],
                    },
                  },
                  input: {
                    key1: 'value1',
                  },
                },
              },
            ],
          },
        };

        awsCompileEventBridgeEvents.compileEventBridgeEvents();
        const {
          Resources,
        } = awsCompileEventBridgeEvents.serverless.service.provider.compiledCloudFormationTemplate;

        expect(Resources).to.deep.equal({
          FirstEventBridgeLambdaPermission1: {
            Type: 'AWS::Lambda::Permission',
            Properties: {
              Action: 'lambda:InvokeFunction',
              FunctionName: {
                Ref: 'FirstLambdaFunction',
              },
              Principal: 'events.amazonaws.com',
              SourceArn: {
                'Fn::Join': [
                  ':',
                  [
                    'arn',
                    { Ref: 'AWS::Partition' },
                    'events',
                    { Ref: 'AWS::Region' },
                    { Ref: 'AWS::AccountId' },
                    {
                      'Fn::Join': ['/', ['rule', 'first-rule-1']],
                    },
                  ],
                ],
              },
            },
          },
          Firstrule1EventBridgeRule: {
            Type: 'AWS::Events::Rule',
            Properties: {
              EventBusName: undefined,
              EventPattern:
                '{"source":["aws.cloudformation"],"detail-type":["AWS API Call via CloudTrail"],"detail":{"eventSource":["cloudformation.amazonaws.com"]}}',
              Name: 'first-rule-1',
              ScheduleExpression: undefined,
              State: 'ENABLED',
              Targets: [
                {
                  Arn: {
                    'Fn::GetAtt': ['FirstLambdaFunction', 'Arn'],
                  },
                  Id: 'first-rule-1-target',
                  Input: '{"key1":"value1"}',
                },
              ],
            },
          },
        });
      });

      it('should create the necessary resources when using an inputPath configuration', () => {
        awsCompileEventBridgeEvents.serverless.service.provider.eventBridge = {
          useCloudFormation: true,
        };
        awsCompileEventBridgeEvents.serverless.service.functions = {
          first: {
            name: 'first',
            events: [
              {
                eventBridge: {
                  pattern: {
                    'source': ['aws.cloudformation'],
                    'detail-type': ['AWS API Call via CloudTrail'],
                    'detail': {
                      eventSource: ['cloudformation.amazonaws.com'],
                    },
                  },
                  inputPath: '$.stageVariables',
                },
              },
            ],
          },
        };

        awsCompileEventBridgeEvents.compileEventBridgeEvents();
        const {
          Resources,
        } = awsCompileEventBridgeEvents.serverless.service.provider.compiledCloudFormationTemplate;

        expect(Resources).to.deep.equal({
          FirstEventBridgeLambdaPermission1: {
            Type: 'AWS::Lambda::Permission',
            Properties: {
              Action: 'lambda:InvokeFunction',
              FunctionName: {
                Ref: 'FirstLambdaFunction',
              },
              Principal: 'events.amazonaws.com',
              SourceArn: {
                'Fn::Join': [
                  ':',
                  [
                    'arn',
                    { Ref: 'AWS::Partition' },
                    'events',
                    { Ref: 'AWS::Region' },
                    { Ref: 'AWS::AccountId' },
                    {
                      'Fn::Join': ['/', ['rule', 'first-rule-1']],
                    },
                  ],
                ],
              },
            },
          },
          Firstrule1EventBridgeRule: {
            Type: 'AWS::Events::Rule',
            Properties: {
              EventBusName: undefined,
              EventPattern:
                '{"source":["aws.cloudformation"],"detail-type":["AWS API Call via CloudTrail"],"detail":{"eventSource":["cloudformation.amazonaws.com"]}}',
              Name: 'first-rule-1',
              ScheduleExpression: undefined,
              State: 'ENABLED',
              Targets: [
                {
                  Arn: {
                    'Fn::GetAtt': ['FirstLambdaFunction', 'Arn'],
                  },
                  Id: 'first-rule-1-target',
                  InputPath: '$.stageVariables',
                },
              ],
            },
          },
        });
      });

      describe('when using an inputTransformer configuration', () => {
        it('should create the necessary resources', () => {
          awsCompileEventBridgeEvents.serverless.service.provider.eventBridge = {
            useCloudFormation: true,
          };
          awsCompileEventBridgeEvents.serverless.service.functions = {
            first: {
              name: 'first',
              events: [
                {
                  eventBridge: {
                    pattern: {
                      'source': ['aws.cloudformation'],
                      'detail-type': ['AWS API Call via CloudTrail'],
                      'detail': {
                        eventSource: ['cloudformation.amazonaws.com'],
                      },
                    },
                    inputTransformer: {
                      inputTemplate: '{"time": <eventTime>, "key1": "value1"}',
                      inputPathsMap: {
                        eventTime: '$.time',
                      },
                    },
                  },
                },
              ],
            },
          };

          awsCompileEventBridgeEvents.compileEventBridgeEvents();
          const {
            Resources,
          } = awsCompileEventBridgeEvents.serverless.service.provider.compiledCloudFormationTemplate;

          expect(Resources).to.deep.equal({
            FirstEventBridgeLambdaPermission1: {
              Type: 'AWS::Lambda::Permission',
              Properties: {
                Action: 'lambda:InvokeFunction',
                FunctionName: {
                  Ref: 'FirstLambdaFunction',
                },
                Principal: 'events.amazonaws.com',
                SourceArn: {
                  'Fn::Join': [
                    ':',
                    [
                      'arn',
                      { Ref: 'AWS::Partition' },
                      'events',
                      { Ref: 'AWS::Region' },
                      { Ref: 'AWS::AccountId' },
                      {
                        'Fn::Join': ['/', ['rule', 'first-rule-1']],
                      },
                    ],
                  ],
                },
              },
            },
            Firstrule1EventBridgeRule: {
              Type: 'AWS::Events::Rule',
              Properties: {
                EventBusName: undefined,
                EventPattern:
                  '{"source":["aws.cloudformation"],"detail-type":["AWS API Call via CloudTrail"],"detail":{"eventSource":["cloudformation.amazonaws.com"]}}',
                Name: 'first-rule-1',
                ScheduleExpression: undefined,
                State: 'ENABLED',
                Targets: [
                  {
                    Arn: {
                      'Fn::GetAtt': ['FirstLambdaFunction', 'Arn'],
                    },
                    Id: 'first-rule-1-target',
                    InputTransformer: {
                      InputPathsMap: {
                        eventTime: '$.time',
                      },
                      InputTemplate: '{"time": <eventTime>, "key1": "value1"}',
                    },
                  },
                ],
              },
            },
          });
        });
      });
    });
  });
});
const NAME_OVER_64_CHARS = 'oneVeryLongAndVeryStrangeAndVeryComplicatedFunctionNameOver64Chars';

const serverlessConfigurationExtension = {
  functions: {
    default: {
      handler: 'index.handler',
      events: [
        {
          eventBridge: {
            eventBus: 'arn:aws:events:us-east-1:12345:event-bus/default',
            schedule: 'rate(10 minutes)',
          },
        },
      ],
    },
    [NAME_OVER_64_CHARS]: {
      handler: 'index.handler',
      name: 'one-very-long-and-very-strange-and-very-complicated-function-name-over-64-chars',
      events: [
        {
          eventBridge: {
            schedule: 'rate(10 minutes)',
            pattern: {
              'source': ['aws.cloudformation'],
              'detail-type': ['AWS API Call via CloudTrail'],
              'detail': {
                eventSource: ['cloudformation.amazonaws.com'],
              },
            },
          },
        },
      ],
    },
    configureInput: {
      handler: 'index.handler',
      events: [
        {
          eventBridge: {
            eventBus: 'arn:aws:events:us-east-1:12345:event-bus/some-event-bus',
            schedule: 'rate(10 minutes)',
            pattern: {
              'source': ['aws.cloudformation'],
              'detail-type': ['AWS API Call via CloudTrail'],
              'detail': {
                eventSource: ['cloudformation.amazonaws.com'],
              },
            },
            input: {
              key1: 'value1',
              key2: {
                nested: 'value2',
              },
            },
          },
        },
      ],
    },
    inputPathConfiguration: {
      handler: 'index.handler',
      events: [
        {
          eventBridge: {
            pattern: {
              'source': ['aws.cloudformation'],
              'detail-type': ['AWS API Call via CloudTrail'],
              'detail': {
                eventSource: ['cloudformation.amazonaws.com'],
              },
            },
            inputPath: '$.stageVariables',
          },
        },
      ],
    },
    inputTransformer: {
      handler: 'index.handler',
      events: [
        {
          eventBridge: {
            pattern: {
              'source': ['aws.cloudformation'],
              'detail-type': ['AWS API Call via CloudTrail'],
              'detail': {
                eventSource: ['cloudformation.amazonaws.com'],
              },
            },
            inputTransformer: {
              inputTemplate: '{"time": <eventTime>, "key1": "value1"}',
              inputPathsMap: {
                eventTime: '$.time',
              },
            },
          },
        },
      ],
    },
    customSaas: {
      handler: 'index.handler',
      events: [
        {
          eventBridge: {
            eventBus: 'custom-saas-events',
            pattern: {
              detail: {
                eventSource: ['saas.external'],
              },
            },
            inputTransformer: {
              inputTemplate: '{"time": <eventTime>, "key1": "value1"}',
              inputPathsMap: {
                eventTime: '$.time',
              },
            },
          },
        },
      ],
    },
  },
};

describe('EventBridgeEvents', () => {
  let cfResources;
  let naming;

  before(() =>
    runServerless({
      fixture: 'function',
      configExt: serverlessConfigurationExtension,
      cliArgs: ['package'],
    }).then(({ cfTemplate, awsNaming }) => {
      ({ Resources: cfResources } = cfTemplate);
      naming = awsNaming;
    })
  );

  /**
   *
   * @param {String} id
   */
  function getEventBridgeConfigById(resourceLogicalId) {
    const eventBridgeId = naming.getCustomResourceEventBridgeResourceLogicalId(
      resourceLogicalId,
      1
    );
    return cfResources[eventBridgeId].Properties.EventBridgeConfig;
  }

  it('should create the correct policy Statement', () => {
    const roleId = naming.getCustomResourcesRoleLogicalId('default', '12345');

    const [firstStatement, secondStatement, thirdStatment] = cfResources[
      roleId
    ].Properties.Policies[0].PolicyDocument.Statement;
    expect(firstStatement.Effect).to.be.eq('Allow');
    expect(firstStatement.Resource['Fn::Join'][1]).to.deep.include('arn');
    expect(firstStatement.Resource['Fn::Join'][1]).to.deep.include('events');
    expect(firstStatement.Resource['Fn::Join'][1]).to.deep.include('event-bus/*');
    expect(firstStatement.Action).to.be.deep.eq(['events:CreateEventBus', 'events:DeleteEventBus']);

    expect(secondStatement.Effect).to.be.eq('Allow');
    expect(secondStatement.Resource['Fn::Join'][1]).to.deep.include('events');
    expect(secondStatement.Resource['Fn::Join'][1]).to.deep.include('rule/*');
    expect(secondStatement.Action).to.be.deep.eq([
      'events:PutRule',
      'events:RemoveTargets',
      'events:PutTargets',
      'events:DeleteRule',
    ]);

    expect(thirdStatment.Effect).to.be.eq('Allow');
    expect(thirdStatment.Resource['Fn::Join'][1]).to.deep.include('function');
    expect(thirdStatment.Resource['Fn::Join'][1]).to.deep.include('lambda');
    expect(thirdStatment.Action).to.be.deep.eq(['lambda:AddPermission', 'lambda:RemovePermission']);
  });
  it('should create the necessary resource', () => {
    const eventBridgeConfig = getEventBridgeConfigById('default');
    expect(eventBridgeConfig.RuleName).to.include('dev-default-rule-1');
  });

  it("should ensure rule name doesn't exceed 64 chars", () => {
    const eventBridgeConfig = getEventBridgeConfigById(NAME_OVER_64_CHARS);
    expect(eventBridgeConfig.RuleName.endsWith('rule-1')).to.be.true;
    expect(eventBridgeConfig.RuleName).lengthOf.lte(64);
  });

  it('should support input configuration', () => {
    const eventBridgeConfig = getEventBridgeConfigById('configureInput');
    expect(eventBridgeConfig.Input.key1).be.eq('value1');
    expect(eventBridgeConfig.Input.key2).be.deep.eq({
      nested: 'value2',
    });
  });

  it('should support arn at eventBus', () => {
    const eventBridgeConfig = getEventBridgeConfigById('configureInput');
    expect(eventBridgeConfig.EventBus).be.eq(
      'arn:aws:events:us-east-1:12345:event-bus/some-event-bus'
    );
  });
  it('should support inputPath configuration', () => {
    const eventBridgeConfig = getEventBridgeConfigById('inputPathConfiguration');
    expect(eventBridgeConfig.InputPath).be.eq('$.stageVariables');
  });

  it('should support inputTransformer configuration', () => {
    const eventBridgeConfig = getEventBridgeConfigById('inputTransformer');
    const {
      InputTemplate,
      InputPathsMap: { eventTime },
    } = eventBridgeConfig.InputTransformer;
    expect(InputTemplate).be.eq('{"time": <eventTime>, "key1": "value1"}');
    expect(eventTime).be.eq('$.time');
  });

  it('should register created and delete event bus permissions for non default event bus', () => {
    const roleId = naming.getCustomResourcesRoleLogicalId('customSaas', '12345');
    const [firstStatement] = cfResources[roleId].Properties.Policies[0].PolicyDocument.Statement;
    expect(firstStatement.Action[0]).to.be.eq('events:CreateEventBus');
    expect(firstStatement.Action[1]).to.be.eq('events:DeleteEventBus');
    expect(firstStatement.Effect).to.be.eq('Allow');
  });
});
