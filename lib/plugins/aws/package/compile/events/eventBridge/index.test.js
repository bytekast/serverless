'use strict';

const chai = require('chai');
const runServerless = require('../../../../../../../test/utils/run-serverless');
const { makeAndHashRuleName } = require('./helpers');

chai.use(require('sinon-chai'));
chai.use(require('chai-as-promised'));

const { expect } = chai;

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

  function getFunctionName(resources, functionLogicalIdStub) {
    return resources[`${functionLogicalIdStub}LambdaFunction`].Properties.FunctionName;
  }

  async function compile(config) {
    const functionLogicalIdStub = 'TestFunction';
    const {
      cfTemplate: { Resources },
      awsNaming,
    } = await runServerless({
      fixture: 'function',
      configExt: {
        provider: {
          eventBridge: {
            useCloudFormation: true,
          },
        },
        functions: {
          [functionLogicalIdStub]: {
            handler: 'index.handler',
            events: [
              {
                eventBridge: {
                  schedule: 'rate(10 minutes)',
                  ...config,
                },
              },
            ],
          },
        },
      },
      cliArgs: ['package'],
    });
    return [Resources, awsNaming, functionLogicalIdStub];
  }

  describe('using custom resource deployment pattern', () => {
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

    it('should create the correct policy Statement', () => {
      const roleId = naming.getCustomResourcesRoleLogicalId('default', '12345');

      const [firstStatement, secondStatement, thirdStatment] = cfResources[
        roleId
      ].Properties.Policies[0].PolicyDocument.Statement;
      expect(firstStatement.Effect).to.be.eq('Allow');
      expect(firstStatement.Resource['Fn::Join'][1]).to.deep.include('arn');
      expect(firstStatement.Resource['Fn::Join'][1]).to.deep.include('events');
      expect(firstStatement.Resource['Fn::Join'][1]).to.deep.include('event-bus/*');
      expect(firstStatement.Action).to.be.deep.eq([
        'events:CreateEventBus',
        'events:DeleteEventBus',
      ]);

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
      expect(thirdStatment.Action).to.be.deep.eq([
        'lambda:AddPermission',
        'lambda:RemovePermission',
      ]);
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
  describe('using cloudformation deployment pattern', () => {
    it('should not create an event bus resource when eventBus is an arn string', async () => {
      const [Resources] = await compile({
        eventBus: 'arn:stringthatbeginswitharn:',
      });
      Object.keys(Resources).forEach(resource => {
        expect(Resources[resource]).not.to.have.property('Type', 'AWS::Events::EventBus');
      });
    });

    [
      { Ref: 'EventBus' },
      { 'Fn::ImportValue': 'EventBus' },
      { 'Fn::GetAtt': ['EventBus', 'Arn'] },
    ].forEach(cfFunc => {
      it('should not create an event bus resource when eventBus is a cloudformation function', async () => {
        const [Resources] = await compile({
          eventBus: cfFunc,
        });
        Object.keys(Resources).forEach(resource => {
          expect(Resources[resource]).not.to.have.property('Type', 'AWS::Events::EventBus');
        });
      });
    });

    it('should not create an event bus resource when eventBus not set', async () => {
      const [Resources] = await compile();
      Object.keys(Resources).forEach(resource => {
        expect(Resources[resource]).not.to.have.property('Type', 'AWS::Events::EventBus');
      });
    });

    it('should not create an event bus resource when eventBus is set to "default"', async () => {
      const [Resources] = await compile({
        eventBus: 'default',
      });
      Object.keys(Resources).forEach(resource => {
        expect(Resources[resource]).not.to.have.property('Type', 'AWS::Events::EventBus');
      });
    });

    it('should create an event bus resource when eventBus is named', async () => {
      const eventBusName = 'named-event-bus';
      const [Resources, _naming] = await compile({
        eventBus: eventBusName,
      });
      const eventBusLogicalId = _naming.getEventBridgeEventBusLogicalId(eventBusName);

      expect(Resources[eventBusLogicalId]).to.have.property('Type', 'AWS::Events::EventBus');
      expect(Resources[eventBusLogicalId].Properties).to.have.property('Name', eventBusName);
    });

    it('should create a rule that depends on an event bus when the event bus is part of this stack', async () => {
      const eventBusName = 'named-event-bus';
      const [Resources, _naming, functionNameStub] = await compile({
        eventBus: eventBusName,
      });
      const ruleLogicalId = _naming.getEventBridgeRuleLogicalId(
        `${getFunctionName(Resources, functionNameStub)}-rule-1`
      );
      const eventBusLogicalId = _naming.getEventBridgeEventBusLogicalId(eventBusName);

      expect(Resources[ruleLogicalId]).to.have.property('DependsOn', eventBusLogicalId);
    });

    it('should create a lambda permission with default event bus without event bus name in SourceArn', async () => {
      const [Resources, _naming, functionNameStub] = await compile();
      /*
       * Base 'function' fixture already defines a function at index 0,
       * these tests define their own at index 1
       */
      const functionIndex = 1;
      const lambdaPermissionLogicalId = _naming.getEventBridgeLambdaPermissionLogicalId(
        functionNameStub,
        functionIndex
      );
      const ruleName = makeAndHashRuleName({
        functionName: getFunctionName(Resources, functionNameStub),
        index: functionIndex,
      });
      const lambdaPermissionResource = Resources[lambdaPermissionLogicalId];
      const permissionSouorceArn = lambdaPermissionResource.Properties.SourceArn;

      expect(lambdaPermissionResource).to.have.property('Type', 'AWS::Lambda::Permission');
      expect(permissionSouorceArn['Fn::Join'][1]).to.deep.include('arn');
      expect(permissionSouorceArn['Fn::Join'][1]).to.deep.include('events');
      expect(permissionSouorceArn['Fn::Join'][1][5]['Fn::Join'][1]).to.deep.include('rule');
      expect(permissionSouorceArn['Fn::Join'][1][5]['Fn::Join'][1]).to.deep.include(ruleName);
      expect(permissionSouorceArn['Fn::Join'][1][5]['Fn::Join'][1]).not.to.deep.include('default');
    });

    it('should create a lambda permission with non-default event bus with event bus name in SourceArn', async () => {
      const [Resources, _naming, functionNameStub] = await compile({
        eventBus: 'non-default-event-bus',
      });
      /*
       * Base 'function' fixture already defines a function at index 0,
       * these tests define their own at index 1
       */
      const functionIndex = 1;
      const lambdaPermissionLogicalId = _naming.getEventBridgeLambdaPermissionLogicalId(
        functionNameStub,
        functionIndex
      );
      const ruleName = makeAndHashRuleName({
        functionName: getFunctionName(Resources, functionNameStub),
        index: functionIndex,
      });
      const lambdaPermissionResource = Resources[lambdaPermissionLogicalId];
      const permissionSouorceArn = lambdaPermissionResource.Properties.SourceArn;

      expect(lambdaPermissionResource).to.have.property('Type', 'AWS::Lambda::Permission');
      expect(permissionSouorceArn['Fn::Join'][1]).to.deep.include('arn');
      expect(permissionSouorceArn['Fn::Join'][1]).to.deep.include('events');
      expect(permissionSouorceArn['Fn::Join'][1][5]['Fn::Join'][1]).to.deep.include('rule');
      expect(permissionSouorceArn['Fn::Join'][1][5]['Fn::Join'][1]).to.deep.include(ruleName);
      expect(permissionSouorceArn['Fn::Join'][1][5]['Fn::Join'][1]).to.deep.include(
        'non-default-event-bus'
      );
    });

    describe('creating a rule resource', () => {
      it('should create a rule', async () => {
        const [Resources, _naming, functionNameStub] = await compile();
        const ruleLogicalId = _naming.getEventBridgeRuleLogicalId(
          `${getFunctionName(Resources, functionNameStub)}-rule-1`
        );
        /*
         * Base 'function' fixture already defines a function at index 0,
         * these tests define their own at index 1
         */
        const functionIndex = 1;
        const ruleName = makeAndHashRuleName({
          functionName: getFunctionName(Resources, functionNameStub),
          index: functionIndex,
        });

        expect(Resources[ruleLogicalId]).to.have.property('Type', 'AWS::Events::Rule');
        expect(Resources[ruleLogicalId].Properties).to.have.property('Name', ruleName);
        expect(Resources[ruleLogicalId].Properties).to.have.property('EventBusName', undefined);
        expect(Resources[ruleLogicalId].Properties).to.have.property('State', 'ENABLED');
      });

      it('should set a schedule for the rule', async () => {
        const schedule = 'rate(10 minutes)';
        const [Resources, _naming, functionNameStub] = await compile({
          schedule,
        });
        const ruleLogicalId = _naming.getEventBridgeRuleLogicalId(
          `${getFunctionName(Resources, functionNameStub)}-rule-1`
        );

        expect(Resources[ruleLogicalId].Properties).to.have.property(
          'ScheduleExpression',
          schedule
        );
      });

      it('should set an event pattern for the rule', async () => {
        const pattern = {
          source: ['serverless.test'],
        };
        const [Resources, _naming, functionNameStub] = await compile({
          schedule: undefined,
          pattern,
        });
        const ruleLogicalId = _naming.getEventBridgeRuleLogicalId(
          `${getFunctionName(Resources, functionNameStub)}-rule-1`
        );

        expect(Resources[ruleLogicalId].Properties).to.have.property(
          'EventPattern',
          JSON.stringify(pattern)
        );
      });

      it('should set an input on the target for the rule', async () => {
        const input = {
          key1: 'value1',
          key2: {
            nested: 'value2',
          },
        };
        const [Resources, _naming, functionNameStub] = await compile({
          input,
        });
        const ruleLogicalId = _naming.getEventBridgeRuleLogicalId(
          `${getFunctionName(Resources, functionNameStub)}-rule-1`
        );

        expect(Resources[ruleLogicalId].Properties.Targets).to.have.length(1);
        expect(Resources[ruleLogicalId].Properties.Targets[0].Input).to.eq(JSON.stringify(input));
        expect(Resources[ruleLogicalId].Properties.Targets[0].InputPath).to.be.undefined;
        expect(Resources[ruleLogicalId].Properties.Targets[0].InputTransformer).to.be.undefined;
      });

      it('should set an input path on the target for the rule', async () => {
        const inputPath = '$.stageVariables';
        const [Resources, _naming, functionNameStub] = await compile({
          inputPath,
        });
        const ruleLogicalId = _naming.getEventBridgeRuleLogicalId(
          `${getFunctionName(Resources, functionNameStub)}-rule-1`
        );

        expect(Resources[ruleLogicalId].Properties.Targets).to.have.length(1);
        expect(Resources[ruleLogicalId].Properties.Targets[0].Input).to.be.undefined;
        expect(Resources[ruleLogicalId].Properties.Targets[0].InputPath).to.eq(inputPath);
        expect(Resources[ruleLogicalId].Properties.Targets[0].InputTransformer).to.be.undefined;
      });

      it('should set an input tranformer on the target for the rule', async () => {
        const [Resources, _naming, functionNameStub] = await compile({
          inputTransformer: {
            inputTemplate: '{"time": <eventTime>, "key1": "value1"}',
            inputPathsMap: {
              eventTime: '$.time',
            },
          },
        });
        const ruleLogicalId = _naming.getEventBridgeRuleLogicalId(
          `${getFunctionName(Resources, functionNameStub)}-rule-1`
        );

        expect(Resources[ruleLogicalId].Properties.Targets).to.have.length(1);
        expect(Resources[ruleLogicalId].Properties.Targets[0].Input).to.be.undefined;
        expect(Resources[ruleLogicalId].Properties.Targets[0].InputPath).to.be.undefined;
        expect(Resources[ruleLogicalId].Properties.Targets[0].InputTransformer).to.deep.eq({
          InputTemplate: '{"time": <eventTime>, "key1": "value1"}',
          InputPathsMap: {
            eventTime: '$.time',
          },
        });
      });
    });
  });
});
