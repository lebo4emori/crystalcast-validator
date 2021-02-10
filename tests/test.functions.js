const fs = require('fs');
const FileParser = require('../common/file-parser.js');
const config = require('./config-automated-tests.json');
const chokidar = require('chokidar');
const waitOn = require('wait-on');

/**
 * Test functions for file validator tests
 */
class TestFunctions {
  /**
   * Checks the results of a processed model
   * @param {string} testFilePrefix The prefix the test file (name without a test number)
   * @param {string} testNumber The test number
   * @param {string} testDir The home directory of the test provider
   * @param {string} testFile The whole test file name
   * @param {string} expectedResult The expected outcome ('valid' | 'invalid'), picks expected file directory.
   * @param {string} compressedResults If it's expected that the results are compressed (i.e zipped) or not
   */
  static async checkResults(
    testFilePrefix,
    testNumber,
    testDir,
    testFile,
    expectedResult,
    compressedResults = false
  ) {
    // Get the results path
    let resultsPath =
      testDir +
      '/' +
      config.providers[0].name +
      '/' +
      expectedResult +
      testFile;

    // Determine the incorrect results path
    let incorrectResult;
    if (expectedResult === 'valid') {
      incorrectResult = 'invalid';
    } else if (expectedResult === 'invalid') {
      incorrectResult = 'valid';
    }
    let incorrectResultsPath =
      testDir +
      '/' +
      config.providers[0].name +
      '/' +
      incorrectResult +
      testFile;

    // Watch the incorrect results path to see if a test file ends up there
    let resultsWatcher = chokidar.watch(incorrectResultsPath, {
      persistent: true,
      alwaysStat: false,
      awaitWriteFinish: {
        stabilityThreshold: 3000,
        pollInterval: 100
      }
    });

    // Fail if a test file is added to the wrong valid/invalid folder
    resultsWatcher.on('add', async function (path) {
      throw (
        'Model validated and ended up in the ' +
        incorrectResult +
        ' folder instead of the ' +
        expectedResult +
        ' folder for file ' +
        path
      );
    });

    try {
      // Wait for results file to appear in specified valid/invalid folder before continuing
      await waitOn({
        resources: [resultsPath],
        timeout: 180000,
        simultaneous: 1
      }).catch(err => {
        throw err;
      });

      if (compressedResults) {
        // Confirm that file compression has occured
        const zipResultsPath = resultsPath.replace(
          resultsPath.substr(resultsPath.lastIndexOf('.') + 1),
          'zip'
        );
        await FileParser.checkFileExists(zipResultsPath).then(function (
          result
        ) {
          expect(result).toEqual(true);
        });
      }

      // Compare results against expected, if applicable.
      if (expectedResult === 'invalid') {
        let resultFileName = testFilePrefix + testNumber + '-errors.txt';

        let errorFilePath =
          testDir +
          '/' +
          config.providers[0].name +
          '/' +
          expectedResult +
          '/' +
          resultFileName;
        let expectedResultPath =
          expectedResult === 'invalid'
            ? fs.readFileSync(testDir + '/expected-results/' + resultFileName, {
                encoding: 'utf8'
              })
            : null;
        await new Promise((resolve, reject) => {
          fs.readFile(errorFilePath, { encoding: 'utf8' }, (err, data) => {
            if (err) {
              reject(err);
            } else {
              resolve(data);
            }
          });
        }).then(function (data) {
          const cleanedData = data.replace(/(\r\n|\n|\r|\\)/gm, '');
          const cleanedExpectedResultPath = expectedResultPath.replace(
            /(\r\n|\n|\r|\\)/gm,
            ''
          );
          expect(cleanedData).toEqual(cleanedExpectedResultPath);
        });
      }
    } catch (err) {
      throw err;
    } finally {
      // Close the results watcher
      if (resultsWatcher !== null) {
        resultsWatcher.close();
      }
    }
  }

  /**
   * Pause the current thread using a promise
   * @param {number} ms miliseconds to sleep for
   */
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = TestFunctions;
