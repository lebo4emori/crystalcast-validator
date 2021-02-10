const FileParser = require('../common/file-parser.js');
const validator = require('../validator/file-validator.js');
const config = require('./config-automated-tests.json');
const TestFunctions = require('./test.functions.js');

jest.setTimeout(3.6e6);

/**
 * Note these tests are currently skipped as the best R estimate submissions are no longer required.
 * Not completely removing code yet just in case the requirement returns.
 */
describe('FileValidatorBestRTests', () => {
  /**
   * After all tests run. Cleanup results files.
   */
  afterAll(async () => {
    await TestFunctions.sleep(10000);
    const testDir = config.fileWatch.homeDirs[0];

    // Remove test results.
    // Trap and ignore errors (ENOENT: no such file or directory), as we are clearing down anyway
    await FileParser.clearDown(
      testDir + '/' + config.providers[0].name + '/invalid'
    ).catch(err => {});
    await FileParser.clearDown(
      testDir + '/' + config.providers[0].name + '/valid'
    ).catch(err => {});
  });

  /**
   * Tests a model fails due to blank Generation Process
   */
  test.skip('test-invalid-bestr-case-1', async () => {
    await genericTest(1, '.xlsx', 'invalid');
  });

  /**
   * Tests a model fails due to missing ValueType field
   */
  test.skip('test-invalid-bestr-case-2', async () => {
    await genericTest(2, '.xlsx', 'invalid');
  });

  /**
   *  Tests a valid best R estimate file
   */
  test.skip('test-valid-bestr-case-3', async () => {
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
  let testFilePrefix = 'test-validate-bestr-case-';
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

  // Start validator.
  await FileParser.createDirectory('/' + config.fileWatch.rCaseDataFolder);
  await validator.start();
  await TestFunctions.sleep(1000);

  // COPY the test file to trigger path to trigger validation.
  FileParser.copy(stagingPath, triggerPath, function (err) {
    if (err) throw err;
  });

  // Stop the validator.
  await TestFunctions.sleep(4000);
  await validator.stop();
  await TestFunctions.sleep(2000);

  await TestFunctions.checkResults(
    testFilePrefix,
    testNumber,
    testDir,
    testFile,
    expectedResult
  );
}
