const fs = require('fs');
const FileParser = require('../common/file-parser.js');
const validator = require('../validator/file-validator.js');
const config = require('./config-automated-tests.json');
const TestFunctions = require('./test.functions.js');

jest.setTimeout(3.6e6);

/**
 * Tests validator for non-individual files - i.e. combined, historical, stacked. Checks
 * that they remain valid.
 *
 */
describe('FileValidatorCombinedTests', () => {
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
   *  Tests that a combined file with model predictions and a DataType column will validate
   */
  test('test-combined-model-case-1', async () => {
    await genericTest(1, '.xlsx', 'valid');
  });

  /**
   *  Tests that an historical file with model predictions and a DataType column will validate
   */
  test('test-historical-model-case-2', async () => {
    await genericTest(2, '.xlsx', 'valid');
  });

  /**
   *  Tests that a stacked file with model predictions, weights and a DataType column will validate
   */
  test('test-stacked-model-case-3', async () => {
    await genericTest(3, '.xlsx', 'valid');
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
async function genericTest(testNumber, extension, expectedResult) {
  let testFilePrefix = 'test-combined-model-case-';
  const testFile = '/' + testFilePrefix + testNumber + extension,
    testDir = config.fileWatch.homeDirs[0];

  let stagingPath = testDir + '/staging' + testFile,
    triggerPath =
      testDir +
      '/' +
      config.providers[0].name +
      '/' +
      config.fileWatch.triggerFolder +
      testFile;

  // COPY the test file to trigger path to trigger validation.
  FileParser.copy(stagingPath, triggerPath, function (err) {
    if (err) throw err;
  });

  // confirm that file is present in expected directory, fail if it isn't.
  await TestFunctions.checkResults(
    testFilePrefix,
    testNumber,
    testDir,
    testFile,
    expectedResult
  );
}
