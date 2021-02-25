const FileParser = require('../common/file-parser.js');
const validator = require('../validator/file-validator.js');
const config = require('./config-automated-tests.json');
const TestFunctions = require('./test.functions.js');
jest.setTimeout(3.6e6);

describe('FileValidatorTests', () => {
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
   * Tests a model that has missing fields.
   */
  test('test-invalid-model-case-1', async () => {
    await genericTest(1, '.xlsx', 'invalid');
  });

  /**
   * Tests a model that has incorrect field order validates sucessfully
   */
  test('test-invalid-model-case-2', async () => {
    await genericTest(2, '.xlsx', 'valid');
  });

  /**
   * Tests a model that should have no errors and pass all validation criteria
   */
  test('test-valid-model-case-3', async () => {
    await genericTest(3, '.xlsx', 'valid');
  });

  /**
   * Tests a model that is csv and contains extra spaces in the field names (.csv)
   */
  test('test-invalid-model-case-4', async () => {
    await genericTest(4, '.csv', 'invalid');
  });

  /**
   * Tests a model that should have no errors and pass all validation criteria (.csv)
   */
  test('test-valid-model-case-5', async () => {
    await genericTest(5, '.csv', 'valid');
  });

  /**
   * Tests a that the model has unrecognised fields and is detected as such
   */
  test('test-invalid-model-case-6', async () => {
    await genericTest(6, '.xlsx', 'invalid');
  });

  /**
   * Tests that when an optional field is present, it's not validated against the template values as there isn't any
   */
  test('test-invalid-model-case-7', async () => {
    await genericTest(7, '.xlsx', 'valid');
  });

  /**
   * Tests that invalid model names are correctly identified
   */
  test('test-invalid-model-case-8', async () => {
    await genericTest(8, '.xlsx', 'invalid');
  });

  /**
   * Tests invalid dates
   */
  test('test-invalid-model-case-9', async () => {
    await genericTest(9, '.xlsx', 'invalid');
  });

  /**
   * Tests that the R incidence file does not pass validation if it misses fields
   */
  test('test-valid-model-case-10', async () => {
    await genericTest(10, '.xlsx', 'invalid');
  });

  /**
   * Tests a model with Rt values that should have no errors and pass all validation criteria (.csv)
   */
  test('test-valid-model-case-11', async () => {
    await genericTest(11, '.csv', 'valid');
  });

  /**
   * Tests a model with empty columns included validated successfully
   */
  test('test-valid-model-case-12', async () => {
    await genericTest(12, '.xlsx', 'valid');
  });

  /**
   * Tests model predictions with blank optional fields validate
   */
  test('test-valid-model-case-13', async () => {
    await genericTest(13, '.xlsx', 'valid');
  });

  /**
   *  Tests model predictions with missing mandatory field values doesn't validate
   */
  test('test-invalid-model-case-14', async () => {
    await genericTest(14, '.xlsx', 'invalid');
  });

  /**
   *  Tests that a file with non-sequential & duplicate dates does not validate correctly
   */
  test('test-invalid-model-case-15', async () => {
    await genericTest(15, '.csv', 'invalid');
  });

  /**
   *  Tests validating a file with data from multiple different models
   */
  test('test-invalid-model-case-16', async () => {
    await genericTest(16, '.xlsx', 'valid');
  });

  /**
   *  Tests validating a file with data from multiple different models
   */
  test('test-invalid-model-case-17', async () => {
    await genericTest(17, '.xlsx', 'invalid');
  });

  /**
   *  Tests validating a file with age bands fails if "ALL" ageband is missing for a metric
   */
  test('test-valid-model-case-18', async () => {
    await genericTest(18, '.csv', 'invalid');
  });

  /**
   *  Tests validating a file with age bands sucessfully validates
   */
  test('test-valid-model-case-19', async () => {
    await genericTest(19, '.csv', 'valid');
  });

  /**
   *  Tests validating a file with trailing zeros on quantile inputs
   */
  test('test-valid-model-case-20', async () => {
    await genericTest(20, '.csv', 'valid');
  });

  /**
   *  Tests validating a file with multiple Scenario values
   */
  test('test-valid-model-case-21', async () => {
    await genericTest(21, '.csv', 'valid');
  });

  /**
   *  Tests validating a file with multiple Scenario values and an invalid Scenario value
   */
  test('test-valid-model-case-22', async () => {
    await genericTest(22, '.csv', 'invalid');
  });

  /**
   *  Tests validating a csv file that is too large for emailing and therefore gets zipped
   */
  test('test-valid-model-case-23', async () => {
    await genericTest(23, '.csv', 'valid', true);
  });

  /**
   *  Tests validating a file that has invalid field values for prevalence
   */
  test('test-valid-model-case-24', async () => {
    await genericTest(24, '.csv', 'invalid');
  });

  /**
   * Tests blank column headers for csv files
   */
  test('test-valid-model-case-25', async () => {
    await genericTest(25, '.csv', 'invalid');
  });

  /**
   * Tests a file that has mislabelled scenarios
   */
  test('test-valid-model-case-26', async () => {
    await genericTest(26, '.csv', 'invalid');
  });

  /**
   * Tests validating a csv file that has too many row values
   */
  test('test-valid-model-case-27', async () => {
    await genericTest(27, '.csv', 'invalid');
  });

  /**
   * Tests skipping validation for unsupported file types
   */
  test('test-valid-model-case-28', async () => {
    await genericTest(28, '.xls', 'invalid');
  });

  /**
   * Tests blank column headers for xlsx files
   */
  test('test-valid-model-case-29', async () => {
    await genericTest(29, '.xlsx', 'invalid');
  });

  /**
   * Tests validating an xlsx file that for some reasons has it's sheets read in reverse
   */
  test('test-valid-model-case-30', async () => {
    await genericTest(30, '.xlsx', 'valid');
  });

  /**
   * Tests validating an xlsx file that might have been converted from an xls file
   */
  test('test-valid-model-case-31', async () => {
    await genericTest(31, '.xlsx', 'invalid');
  });

  /**
   * Tests validating a xlsx file that is too large for emailing and therefore gets zipped
   */
  test('test-valid-model-case-32', async () => {
    await genericTest(32, '.xlsx', 'valid');
  });

  // TODO: Chat this through with Sow when he's back from leave
  /**
   * Tests validating a xlsx that has too many row values
  //  */
  // test('test-valid-model-case-33', async () => {
  //   await genericTest(33, '.xlsx', 'invalid');
  // });

  /**
   * Tests validating a xlsx that has more than one group in it
   */
  test('test-valid-model-case-34', async () => {
    await genericTest(34, '.xlsx', 'valid');
  });
});

afterAll(async function (done) {
  // Make sure we stop the validator even when tests fail
  validator.stop();
  await TestFunctions.sleep(2000);
  done();
});

/**
 * Performs generic validation test, given the test number and expected outcome.
 *@param {number} testNumber The number of this test, used to select files.
 * @param {string} extension Extension of the file ('.csv' | '.xslx')
 * @param {string} expectedResult The expected outcome ('valid' | 'invalid'), picks expected file directory.
 * @param {boolean} compressedResults If it's expected that the results are compressed (i.e zipped) or not
 */
async function genericTest(
  testNumber,
  extension,
  expectedResult,
  compressedResults = false
) {
  let testFilePrefix = 'test-validate-model-case-';
  const testFile = '/' + testFilePrefix + testNumber + extension,
    testDir = config.fileWatch.homeDirs[0];

  const providerName = config.providers[0].name;
  let stagingPath = testDir + '/staging' + testFile,
    triggerPath =
      testDir +
      '/' +
      providerName +
      '/' +
      config.fileWatch.triggerFolder +
      testFile;

  // COPY the test file to trigger path to trigger validation.
  FileParser.copy(stagingPath, triggerPath, function (err) {
    if (err) throw err;
  });

  await TestFunctions.checkResults(
    testFilePrefix,
    testNumber,
    testDir,
    testFile,
    expectedResult,
    compressedResults
  );
}
