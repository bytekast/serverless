'use strict';

const chai = require('chai');
const runServerless = require('../../../../test/utils/run-serverless');
const expect = require('chai').expect;

chai.use(require('chai-as-promised'));





describe('AwsInvokeLocal', () => {


  describe('Input resolution', () => {
    let opt = { cliArgs: ['invoke local', '--function', 'hello'], fixture: 'functionInvocation'};
    
    
    it('should accept no input data', () => {
      runServerless(opt).then(({stdoutData}) => {
     
              }) 
          
      })
    it('should should support plain string data', () => {
      opt.cliArgs = ['invoke local', '--function', 'hello', '--data', 'simple string']
      runServerless(opt).then(({stdoutData}) => {
               
              }) 
    });
      
    })

});
