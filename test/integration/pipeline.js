/* eslint no-unused-expressions: 0 */
const { PassThrough } = require('stream')
const tmp = require('tmp')
const fs = require('fs')
const path = require('path')
const sinon = require('sinon')
const solc = require('solc')
const notifier = require('node-notifier')
const should = require('chai').should()

const Pipeline = require('../../lib/pipeline')
const { getLogger } = require('../../lib/logging')

const logger = getLogger({loglevel: 'error'})
const firstContractName = 'Hello'
const secondContractName = 'GoodBye'
const firstBytecode = 'hello-bytecode'
const secondBytecode = 'goodbye-bytecode'
const firstDeployedBytecode = 'hello-deployed-bytecode'
const secondDeployedBytecode = 'goodbye-deployed-bytecode'
const firstSourceMap = 'hello-sourcemap'
const secondSourceMap = 'goodbye-sourcemap'
const firstDeployedSourceMap = 'hello-deployed-sourcemap'
const secondDeployedSourceMap = 'goodbye-deployed-sourcemap'
const fileName = 'test.sol'
const contractContent = 'fake content'
const source = {}
source[fileName] = contractContent
const firstOptions = {
  analysisMode: 'full',
  contractName: firstContractName,
  bytecode: firstBytecode,
  deployedBytecode: firstDeployedBytecode,
  sources: source,
  sourceList: [fileName],
  sourceMap: firstSourceMap,
  deployedSourceMap: firstDeployedSourceMap
}
const secondOptions = {
  analysisMode: 'full',
  contractName: secondContractName,
  bytecode: secondBytecode,
  deployedBytecode: secondDeployedBytecode,
  sources: source,
  sourceList: [fileName],
  sourceMap: secondSourceMap,
  deployedSourceMap: secondDeployedSourceMap
}
const expectedIssues = [
  {
    title: 'Unchecked SUICIDE',
    description: 'The function `_function_0xcbf0b0c0` executes the SUICIDE instruction. The remaining Ether is sent to an address provided as a function argument.\n\nIt seems that this function can be called without restrictions.',
    function: '_function_0xcbf0b0c0',
    type: 'Warning',
    address: 156,
    debug: 'SOLVER OUTPUT:\ncalldata_MAIN_0: 0xcbf0b0c000000000000000000000000000000000000000000000000000000000\ncalldatasize_MAIN: 0x4\ncallvalue: 0x0\n'
  }
]

const analyzer = {analyze: () => {}}

describe('pipeline', () => {
  beforeEach(() => {
    sinon.stub(solc, 'compileStandardWrapper')
      .withArgs(JSON.stringify({
        language: 'Solidity',
        sources: {
          [fileName]: {
            content: contractContent
          }
        },
        settings: {
          outputSelection: {
            '*': {
              '*': [ 'evm.deployedBytecode', 'evm.bytecode' ]
            }
          }
        }
      }))
      .returns(JSON.stringify({
        contracts: {
          [fileName]: {
            [firstContractName]: {
              evm: {
                bytecode: {
                  object: firstBytecode,
                  sourceMap: firstSourceMap
                },
                deployedBytecode: {
                  object: firstDeployedBytecode,
                  sourceMap: firstDeployedSourceMap
                }
              }
            },
            [secondContractName]: {
              evm: {
                bytecode: {
                  object: secondBytecode,
                  sourceMap: secondSourceMap
                },
                deployedBytecode: {
                  object: secondDeployedBytecode,
                  sourceMap: secondDeployedSourceMap
                }
              }
            }
          }
        }
      }))

    sinon.stub(analyzer, 'analyze')
      .withArgs({data: firstOptions})
      .returns(new Promise(resolve => {
        resolve([])
      }))
      .withArgs({data: secondOptions})
      .returns(new Promise(resolve => {
        resolve(expectedIssues)
      }))

    sinon.stub(notifier, 'notify')
  })

  afterEach(() => {
    solc.compileStandardWrapper.restore()
    notifier.notify.restore()
  })

  it('should write result files', done => {
    const tmpDir = tmp.dirSync().name
    const pipeline = new Pipeline({contractsPath: tmpDir, analyzer: analyzer, logger: logger})
    const origin = pipeline.run()
    const target = PassThrough({objectMode: true})

    origin.pipe(target)

    const filePath = path.resolve(tmpDir, fileName)
    fs.writeFile(filePath, contractContent, err => {
      should.not.exist(err)
    })

    const firstResultsPath = [filePath, firstContractName, 'mythril'].join('.')
    const secondResultsPath = [filePath, secondContractName, 'mythril'].join('.')

    let first = true

    target.on('data', (data) => {
      data.filePath.should.equal(filePath)

      if (first) {
        data.contract.name.should.equal(firstContractName)
        data.contract.bytecode.should.equal(firstBytecode)
        data.analysis.issues.should.deep.equal([])
        data.results.path.should.equal(firstResultsPath)
        data.notified.should.be.false

        first = false
      } else {
        data.contract.name.should.equal(secondContractName)
        data.contract.bytecode.should.equal(secondBytecode)
        data.analysis.issues.should.deep.equal(expectedIssues)
        data.results.path.should.equal(secondResultsPath)
        data.notified.should.be.ok

        pipeline.stop()
        done()
      }
    })
  })
})
