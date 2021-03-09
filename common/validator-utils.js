const moment = require('moment');

/**
 * Utility class for the validator
 */
class ValidatorUtils {
  /**
   * Validate a date string.
   * @param {string} dateString The date string of format 'yyyy-MM-dd'
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

module.exports = ValidatorUtils;
