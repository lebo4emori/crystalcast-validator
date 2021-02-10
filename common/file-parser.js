const mv = require('mv');
const cp = require('cp');
const fs = require('fs');
const rimraf = require('rimraf');
const moment = require('moment');
const csv = require('csv-parser');
const XlsxStreamReader = require('xlsx-stream-reader');

const EMPTY_COLUMN = 'EMPTY';
const BLANK_VALUE = 'blank';

/**
 * Parses files into Json
 */
class FileParser {
  /**
   * Parses csv or xlsx files into Json
   * @param {string} filePath
   */
  static async parse(filePath) {
    if (filePath.endsWith('.csv')) {
      return FileParser.__parseCSV(filePath);
    } else if (filePath.endsWith('.xlsx')) {
      return FileParser.__parseXlsx(filePath);
    }
  }

  /**
   * Parses xlsx files using streams
   * @param {string} filePath
   */
  static async __parseXlsx(filePath) {
    let options = { formatting: false };
    return new Promise(async function (resolve, reject) {
      let parsedJSON = {};
      try {
        let workBookReader = new XlsxStreamReader(options);
        workBookReader.on('error', function (error) {
          throw error;
        });
        workBookReader.on('worksheet', function (workSheetReader) {
          const workSheetName = workSheetReader.name;
          parsedJSON[workSheetName + '_' + workSheetReader.id] = {};
          let headers = [];
          let rows = [];
          if (workSheetReader.id > 2) {
            // We only want first 2 sheets
            workSheetReader.skip();
            return;
          }

          workSheetReader.on('row', function (row) {
            const values = row.values;
            if (values.filter(x => x).length) {
              // First row for column names
              if (row.attributes.r == 1) {
                headers.push(...FileParser.__getHeaderFromRow(row));
              } else {
                const rowJson = {};
                row.values.forEach(function (rowVal, colNum) {
                  // Add the cell value to the correct header
                  if (colNum <= headers.length) {
                    const initialHeader = headers[colNum - 1];
                    const header =
                      initialHeader === EMPTY_COLUMN
                        ? FileParser.__createEmptyColumnString(colNum)
                        : initialHeader;
                    if (FileParser.__isEmptyNullOrUnassigned(rowVal)) {
                      rowJson[header] = BLANK_VALUE;
                    } else {
                      rowJson[header] = rowVal;
                    }
                  }
                });
                // If the row json is too short, then it means there are undetected blank cells
                // that need filling in with the blank keyword.
                if (Object.keys(rowJson).length < headers.length) {
                  headers.forEach(header => {
                    if (!rowJson.hasOwnProperty(header)) {
                      rowJson[header] = BLANK_VALUE;
                    }
                  });
                }
                rows.push(rowJson);
              }
            }
          });
          workSheetReader.on('end', function () {
            // End of worksheet reached
            parsedJSON[workSheetName + '_' + workSheetReader.id] = rows;
          });

          // Call process after registering handlers
          workSheetReader.process();
        });

        workBookReader.on('end', function () {
          // End of workbook reached
          resolve(parsedJSON);
        });

        // Read in the xlsx file
        fs.createReadStream(filePath).pipe(workBookReader);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Parses CSV files using streams
   * @param {string} filePath the file path
   */
  static async __parseCSV(filePath) {
    return new Promise(async function (resolve, reject) {
      let parsedJSON = {};
      parsedJSON['CSV_SHEET_1'] = [];
      fs.createReadStream(filePath)
        .pipe(
          csv({
            strict: true,
            mapHeaders: ({ header, index }) =>
              FileParser.__isEmptyNullOrUnassigned(header)
                ? FileParser.__createEmptyColumnString(index)
                : header,
            mapValues: ({ header, index, value }) =>
              FileParser.__isEmptyNullOrUnassigned(value) ? BLANK_VALUE : value
          })
        )
        .on('data', data => parsedJSON['CSV_SHEET_1'].push(data))
        .on('end', () => {
          resolve(parsedJSON);
        })
        .on('error', err => {
          reject(err);
        });
    });
  }

  /**
   * Check if a string is empty, null or unassigned
   * @param {sting} value the string to check
   */
  static __isEmptyNullOrUnassigned(value) {
    return value === null || value === undefined || value === '';
  }

  /**
   * Create empty column string
   * @param {integer} index the index of the column
   */
  static __createEmptyColumnString(index) {
    return EMPTY_COLUMN + '__' + index;
  }

  /**
   * Get header from the worksheet
   * @param {object} worksheet the worksheet
   */
  static __getHeaderFromRow(row) {
    let result = [];

    if (row === null || !row.values || !row.values.length) {
      return [];
    }

    for (let i = 1; i < row.values.length; i++) {
      let value = row.values[i];
      if (FileParser.__isEmptyNullOrUnassigned(value)) {
        result.push(EMPTY_COLUMN);
      } else {
        result.push(value);
      }
    }
    return result;
  }

  /**
   * Moves a file from the given targetDirectory (full file name) to the given destination.
   * @param {string} targetDirectory Target file.
   * @param {string} destinationDirectory Destination.
   * @param {function} callback Callback function(err).
   */
  static async move(targetDirectory, destinationDirectory, callback) {
    await mv(targetDirectory, destinationDirectory, callback);
  }

  /**
   * Copies a file from the given targetDirectory (full file name) to the given destination.
   * @param {string} targetDirectory Target file.
   * @param {string} destinationDirectory Destination.
   * @param {function} callback Callback function(err).
   */
  static async copy(targetDirectory, destinationDirectory, callback) {
    await cp(targetDirectory, destinationDirectory, callback);
  }

  /**
   * Checks whether the given targetDirectory is a file that exists.
   * @param {string} targetDirectory Target file being checked.
   */
  static async checkFileExists(targetDirectory) {
    return new Promise((resolve, reject) => {
      try {
        fs.exists(targetDirectory, exists => {
          resolve(exists);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Identifies and removes all files within a given directory, then deletes the folder.
   * @param {string} targetDirectory
   */
  static async clearDown(targetDirectory) {
    return new Promise((resolve, reject) => {
      try {
        fs.exists(targetDirectory, exists => {
          if (exists) {
            for (let file of fs.readdirSync(targetDirectory)) {
              fs.unlinkSync(targetDirectory + '/' + file);
            }

            rimraf(targetDirectory, err => {
              if (err) {
                reject(err);
              }
              resolve();
            });
          }

          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Makes a given directory folder.
   * @param {string} targetDirectory
   */
  static async createDirectory(targetDirectory) {
    return new Promise((resolve, reject) => {
      fs.exists(targetDirectory, exists => {
        if (exists) {
          resolve();
        } else {
          fs.mkdir(targetDirectory, err => {
            if (err) reject(err);
            else resolve();
          });
        }
      });
    });
  }

  /**
   * Validate a date string.
   * @param {string} dateString
   */
  static isValidDate(dateString) {
    try {
      // check string format first!
      let regexMatch = dateString.match(
        /[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/g
      ); // 0000-00-00 ISO date format
      let isValid = false;

      if (regexMatch && regexMatch.length === 1) {
        isValid = moment(dateString).isValid();
      }
      return isValid ? true : false;
    } catch (err) {
      return false;
    }
  }
}

module.exports = FileParser;
