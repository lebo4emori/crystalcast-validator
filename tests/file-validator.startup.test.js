const fs = require('fs');
const FileParser = require('../common/file-parser.js');
const validator = require('../validator/file-validator.js');
const config = require('./config-automated-tests.json');
const TestFunctions = require('./test.functions.js');
const logger = require('../common/logger.js');

jest.setTimeout(3.6e6);

describe('FileValidatorStartupTests', () => {
  /**
   * Start the validator for tests
   */
  beforeAll(async () => {
    // TODO Don't think we need this anymore? Removing to see if it solves linux errors with mkdir permission denied
    //await FileParser.createDirectory('/' + config.fileWatch.rCaseDataFolder);
    validator.start();
    await TestFunctions.sleep(1000);
  });

  /**
   * After all tests run. Cleanup results files.
   */
  afterAll(async () => {
    const testDir = config.fileWatch.homeDirs[0];

    // Remove test results.
    // Trap and ignore errors (ENOENT: no such file or directory), as we are clearing down anyway
    await FileParser.clearDown(
      testDir + '/' + config.providers[0].name + '/invalid'
    ).catch(err => {});
    await FileParser.clearDown(
      testDir + '/' + config.providers[0].name + '/valid'
    ).catch(err => {});
    await TestFunctions.sleep(2000);
  });

  /**
   * Tests that the file validator will pick up any existing files in provider directories on start up
   */
  test('test-startup-watch-1', async () => {
    await genericTest([3], '.xlsx', 'valid');
  });

  /**
   * Tests that the file validator will pick up multiple existing files in provider directories on start up
   */
  test('test-startup-watch-2', async () => {
    await genericTest([5, 11], '.csv', 'valid');
  });
});

afterAll(done => {
  // Make sure we stop the validator even when tests fail
  validator.stop();
  done();
});

/**
 * Performs generic validation test, given the test number and expected outcome.
 * @param {number} testNumber The number of this test, used to select files.
 * @param {string} expectedResult The expected outcome ('valid' | 'invalid'), picks expected file directory.
 * @param {string} extension Extension of the file ('.csv' | '.xslx')
 */
async function genericTest(numbers, extension, expectedResult) {
  const testFilePrefix = 'test-validate-model-case-';
  const testDir = config.fileWatch.homeDirs[0];

  for (let testNumber of numbers) {
    const testFile = '/' + testFilePrefix + testNumber + extension;
    const stagingPath = testDir + '/staging' + testFile;
    const triggerPath =
      testDir +
      '/' +
      config.providers[0].name +
      '/' +
      config.fileWatch.triggerFolder +
      testFile;

    // COPY the test file to trigger path to trigger validaton.
    FileParser.copy(stagingPath, triggerPath, function (err) {
      if (err) throw err;
    });
  }

  // Creating a directory in the trigger folder
  let directory =
    testDir +
    '/' +
    config.providers[0].name +
    '/' +
    config.fileWatch.triggerFolder +
    '/directory';

  // log the path to see if its what's expected
  console.log(directory);
  await FileParser.createDirectory(directory).catch(err => {
    logger.error('error creating directory: ' + err);
  });

  for (let testNumber of numbers) {
    const testFile = '/test-validate-model-case-' + testNumber + extension;

    await TestFunctions.checkResults(
      testFilePrefix,
      testNumber,
      testDir,
      testFile,
      expectedResult
    );
  }
}
