const ValidatorUtils = require('../common/validator-utils.js');

describe('ValidatorUtilsTests', () => {
  /**
   * Tests invalid year in date.
   */
  it('Should return false for invalid date year', () => {
    expect(ValidatorUtils.isValidDate('21-01-01')).toEqual(false);
  });

  /**
   * Tests invalid month in date.
   */
  it('Should return false for invalid month', () => {
    expect(ValidatorUtils.isValidDate('2021-13-01')).toEqual(false);
  });

  /**
   * Tests invalid day in date.
   */
  it('Should return false for invalid day', () => {
    expect(ValidatorUtils.isValidDate('2021-01-50')).toEqual(false);
  });

  /**
   * Tests invalid format.
   */
  it('Should return false for invalid format', () => {
    expect(ValidatorUtils.isValidDate('01/01/2021')).toEqual(false);
  });

  /**
   * Tests invalid format.
   */
  it('Should return true for valid format', () => {
    expect(ValidatorUtils.isValidDate('2021-01-01')).toEqual(true);
  });
});
