const ValidatorUtils = require('../common/validator-utils.js');
const moment = require('moment');

/**
 * Class to handle model validation
 */
class Validator {
  /**
   * Validate a model using a given template
   * @param {Json} model
   * @param {Json} template
   * @param {Object} optionalFields
   * @return {Promise} validation results or error message
   */
  static async validate(model, template, optionalFields) {
    // Always return a Promise
    return new Promise((resolve, reject) => {
      let templateFields = Validator._getHeader(template['Template_2']);
      let templateValues = Validator._getFields(template['Fields_1']);
      let validationMessage = Validator._validateModel(
        model,
        templateFields,
        templateValues,
        optionalFields
      );
      resolve(validationMessage);
    });
  }

  /**
   * Get fields from data
   * @param {Json} data
   */
  static _getFields(data) {
    let fieldValues = {};

    for (let i in data) {
      let row = data[i];

      for (let key in row) {
        // skip loop if the property is from prototype
        if (!Object.prototype.hasOwnProperty.call(row, key)) continue;

        if (!Object.prototype.hasOwnProperty.call(fieldValues, key)) {
          fieldValues[key] = [];
        }
        fieldValues[key].push(row[key]);
      }
    }
    return fieldValues;
  }

  /**
   * Get header from data
   * @param {Json} data
   */
  static _getHeader(data) {
    let headers = data.reduce(function (arr, o) {
      return Object.keys(o).reduce(function (a, k) {
        // Convert "Quantile 0.x0" format headers into "Quantile 0.x"
        let trimmedValue = k.replace(/^0+(\d)|(\d)0+$/gm, '$1$2');
        if (a.indexOf(trimmedValue) == -1) a.push(trimmedValue);
        return a;
      }, arr);
    }, []);
    return headers;
  }

  /**
   * Checks the type of the model file and returns a string - Combined, Historical, or Individual,
   * representing the type. Individual is the default type.
   *
   * @param {Json} dataPage
   * @param {Array} modelFields
   */
  static _deduceDataType(dataPage, modelFields) {
    if (!modelFields.includes('DataType')) {
      return 'Individual';
    }

    let dataTypes = [];
    for (let i in dataPage) {
      let row = dataPage[i];

      dataTypes.push(row['DataType']);
    }

    // expect one data type
    dataTypes = dataTypes.filter((a, b) => dataTypes.indexOf(a) === b);

    return dataTypes[0];
  }

  /**
   * Validate model
   * @param {Json} model
   * @param {Object} templateFields
   * @param {Object} templateValues
   * @param {Object} optionalFields
   */
  static _validateModel(model, templateFields, templateValues, optionalFields) {
    const EMPTY_COLUMN = 'EMPTY';

    let validationMessage = {};
    let errors = {};
    let missingFields = [];
    let unrecognisedFields = [];
    let incorrectFieldValues = [];
    let incompleteDataErrors = [];
    let dateErrors = [];
    let emptyColumnsIndexes = new Set();

    validationMessage['hasErrors'] = false;
    errors.noData = false;

    let indexOfLastSheet = 1;
    if (Object.keys(model).length === 2) {
      indexOfLastSheet = 2;
    }
    // Get the data from the last page
    let lastSheet = Object.keys(model).filter(m =>
      m.toString().includes(indexOfLastSheet)
    );
    let dataPage = model[lastSheet];
    // Combined files something include a 'Weight' sheets as the second sheet
    // if this is the case ignore it and use the first sheet instead
    if (lastSheet[0] === 'Weights_2') {
      dataPage =
        model[Object.keys(model).filter(m => m.toString().includes(1))];
    }

    if (Object.keys(dataPage).length === 0) {
      errors.noData = true;
      validationMessage.errors = errors;
      validationMessage['hasErrors'] = true;
      return validationMessage;
    }

    // Get the model fields
    let modelFields = Validator._getHeader(dataPage);

    if (this._deduceDataType(dataPage, modelFields) != 'Individual') {
      validationMessage['isCombined'] = true;
    } else {
      validationMessage['isCombined'] = false;
    }

    // Check that the model isn't missing fields
    for (let i in templateFields) {
      let field = templateFields[i];
      if (!optionalFields.includes(field) && !modelFields.includes(field)) {
        missingFields.push(field);
      }
    }

    // Check that the model doesn't have an unrecognised/extra fields
    for (let i in modelFields) {
      let modelField = modelFields[i];
      if (modelField.includes(EMPTY_COLUMN)) {
        dataPage.forEach(row => delete row[modelField]);
        emptyColumnsIndexes.add(i);
        continue; // ignore any empty columns and remove so they are not validated later
      }
      // Don't validate fields if this is a combined file - unrecognised fields are model prediction columns
      // TODO: need a better way to validate
      if (
        !validationMessage['isCombined'] &&
        !optionalFields.includes(modelField) &&
        !templateFields.includes(modelField)
      ) {
        unrecognisedFields.push(modelField);
      }
    }

    // Skip the rest of the validation if there are unrecognised or missing fields as the validator needs relies on fields being correct
    if (missingFields.length > 0 || unrecognisedFields.length > 0) {
      // Set errors in validation object is needed
      errors.missingFields = missingFields;
      errors.unrecognisedFields = unrecognisedFields;
      errors.emptyColumnsIndexes = emptyColumnsIndexes;
      validationMessage['hasErrors'] = true;
      validationMessage.errors = errors;
      return validationMessage;
    }

    if (modelFields.includes('AgeBand')) {
      var ageBandErrors = isAllAgeBandPresent(dataPage, modelFields);
      // Check the mandatory 'All' ageBand is present for all metrics
      incompleteDataErrors.push.apply(incompleteDataErrors, ageBandErrors);
    }

    // Create a map to store the supported models for each group
    let supportedModelsByGroup = new Map();

    // Check that the model's fields are valid
    for (let i in dataPage) {
      let row = dataPage[i];
      let rowDates = [];

      let group = row['Group'];

      // If the map doesn't already contain this group then create a new entry for it
      if (!supportedModelsByGroup.has(group)) {
        let groupIndex = templateValues['Group'].indexOf(group);
        let models = templateValues['Model']
          ? templateValues['Model'][groupIndex]
          : null;

        let supportedModels = [];
        if (models) {
          // split to get all models in the case multiple are defined
          supportedModels = models.split(',');
          supportedModels = supportedModels.map(modelName => modelName.trim());
        }

        supportedModelsByGroup.set(group, supportedModels);
      }

      // TODO: This check is specifically for prevalence data but could be done in a more generic way in future
      // Check that if the row is prevalence data then the prevalence value is a percentage
      if (
        row['ValueType'] === 'prevalence' ||
        row['ValueType'] === 'prevalence_mtp'
      ) {
        if (row['Value'] < 0 || row['Value'] > 100) {
          let valueError = {};
          valueError.row = Number(i) + 1;
          valueError.fieldValue = row['Value'];
          valueError.field = 'Value';
          valueError.extraInfo =
            ' because ' + row['ValueType'] + ' should be a percentage.';
          // If the prevalence value is not a percentage then add it as an incorrect field value
          incorrectFieldValues.push(valueError);
        }
      }

      // Ensure that all the nowcast ValueTypes have their scenario set to 'Nowcast'
      let nowcastValueTypes = [
        'R',
        'incidence',
        'growth_rate',
        'prevalence',
        'mean_generation_time',
        'kappa',
        'community_prev',
        'var_generation_time',
        'doubling_time'
      ];
      if (
        nowcastValueTypes.includes(row['ValueType']) &&
        row['Scenario'] !== 'Nowcast' &&
        row['Scenario'] !== 'ONS' &&
        row['Scenario'] !== 'REACT'
      ) {
        // Create an error indicating that the scenario has not been set correctly
        let valueError = {};
        valueError.row = Number(i) + 1;
        valueError.fieldValue = row['Scenario'];
        valueError.field = 'Scenario';
        valueError.extraInfo =
          " because the scenario has not been set correctly.  All Nowcast ValueTypes should have their scenario set to 'Nowcast'.";
        incorrectFieldValues.push(valueError);
      }

      // Ensure that non-nowcast value types do not have their scenario set to 'Nowcast'
      if (
        !nowcastValueTypes.includes(row['ValueType']) &&
        row['Scenario'] === 'Nowcast'
      ) {
        // Create an error indicating that the data has been mislabelled
        let valueError = {};
        valueError.row = Number(i) + 1;
        valueError.fieldValue = row['Scenario'];
        valueError.field = 'Scenario';
        valueError.extraInfo =
          " because the scenario has been mislabelled as 'Nowcast'.";
        incorrectFieldValues.push(valueError);
      }

      for (let key in row) {
        // skip loop if the property is from prototype
        //if (!Object.prototype.hasOwnProperty.call(row, key)) continue
        let value = row[key];
        if (isNaN(value)) {
          value = value.replace('"', '').trim();
        }

        // Get the supported models for this group
        let supportedModelsForGroup = supportedModelsByGroup.get(group);

        if (key === 'Model' && supportedModelsForGroup.length > 0) {
          if (!supportedModelsForGroup.includes(value)) {
            let valueError = {};
            valueError.row = Number(i) + 1;
            valueError.fieldValue = value;
            valueError.field = key;
            incorrectFieldValues.push(valueError);
          }
          continue;
        }

        // Store any date values if appropriate based on the type of date
        if (key.includes('Day')) {
          deduceDate(key, value, 'Day', rowDates);
        }
        if (key.includes('Month')) {
          deduceDate(key, value, 'Month', rowDates);
        }
        if (key.includes('Year')) {
          deduceDate(key, value, 'Year', rowDates);
        }
        if (key.includes('Version')) {
          if (!validateVersion(key, value)) {
            let valueError = {};
            valueError.row = Number(i) + 1;
            valueError.fieldValue = value;
            valueError.field = key;
            incorrectFieldValues.push(valueError);
          }
        }

        if (value === 'blank' && !optionalFields.includes(key)) {
          let valueError = {};
          valueError.row = Number(i) + 1;
          valueError.fieldValue = value;
          valueError.field = key;
          incorrectFieldValues.push(valueError);
        } else if (Object.prototype.hasOwnProperty.call(templateValues, key)) {
          // Special case for best R value which has free text for the Generation Process
          // but it must not be blank (checked above)
          if (
            key !== 'Generation Process' &&
            !templateValues[key].includes(value)
          ) {
            let valueError = {};
            valueError.row = Number(i) + 1;
            valueError.fieldValue = value;
            valueError.field = key;
            incorrectFieldValues.push(valueError);
          }
        }
      }

      // Validate each date
      for (let d in rowDates) {
        let date = rowDates[d];
        let dateString = date['Year'] + '-' + date['Month'] + '-' + date['Day'];
        let validDate = ValidatorUtils.isValidDate(dateString);

        if (!validDate) {
          let dateError = {};
          dateError.row = Number(i) + 1;
          dateError.details = date;
          dateErrors.push(dateError);
        }
      }
    }

    // we can't check dates sequential accurately if we're missing any of filtering values
    if (
      !missingFields.includes('ValueType') &&
      !missingFields.includes('Geography') &&
      !missingFields.includes('AgeBand') &&
      !missingFields.includes('Model') &&
      !missingFields.includes('Scenario') &&
      !missingFields.includes('Version')
    ) {
      // check dates sequential here
      incompleteDataErrors.push.apply(
        incompleteDataErrors,
        checkDates(dataPage)
      );
    }

    let quantileErrors = checkQuantiles(dataPage);

    // Set errors in validation object is needed
    errors.missingFields = missingFields;
    errors.unrecognisedFields = unrecognisedFields;
    errors.incorrectFieldValues = incorrectFieldValues;
    errors.dateErrors = dateErrors;
    errors.quantileErrors = quantileErrors;
    errors.incompleteDataErrors = incompleteDataErrors;
    errors.emptyColumnsIndexes = emptyColumnsIndexes;
    if (Object.values(errors).some(value => value.length > 0)) {
      validationMessage['hasErrors'] = true;
    }
    validationMessage.errors = errors;
    return validationMessage;
  }
}

function padZero(str) {
  if (str.length < 2) {
    return '0' + str;
  } else {
    return str;
  }
}

/**
 * Store the date and deduce it's type based on the date period and remaining string value of the field key
 * @param {*} key the field key
 * @param {*} value  the field value
 * @param {*} datePeriod a specified date period that relates to the template
 * @param {*} dates the current dictionary of dates
 */
function deduceDate(key, value, datePeriod, dates) {
  if (key.includes(datePeriod)) {
    let type = key.replace(datePeriod, '').trim();
    let date = dates.find(d => d.type === type);
    if (dates.length === 0 || !date) {
      date = {};
      date['type'] = type;
      dates.push(date);
    }
    date[datePeriod] = padZero('' + value);
  }
}

/**
 * Validate the version number, i.e. verify it's in the format <major>.<minor>
 * @param {*} key the field key
 * @param {*} value  the field value
 */
function validateVersion(key, value) {
  // Regex to validate the version number, either in the format
  // <major>.<minor> or as a single integer i.e. 1 (interpreted to be 1.0)
  var decimal = /^\d+\.\d+$/;
  var integer = /^\d+$/;

  return decimal.test(value) || integer.test(value);
}

/**
 * Check that the quantile values are correct relative to each other
 * @param {*} dataPage all data from the current file
 */
function checkQuantiles(dataPage) {
  let quantileErrors = [];

  dataPage.forEach(function (row, index) {
    if (row['ValueType'] == 'doubling_time') {
      return; // don't validate "doubling_time" parameter for now
    }

    var objectFilter = function (obj) {
      let result = [],
        key;

      for (key in obj) {
        if (
          Object.prototype.hasOwnProperty.call(obj, key) &&
          key.includes('Quantile') &&
          obj[key] != 'blank'
        ) {
          result.push({
            quantileValue: Number(obj[key]),
            quantile: key.split(' ')[1]
          });
        }
      }

      return result;
    };

    // Get values where the headers contain 'Quantile'
    let quantileObjs = objectFilter(row);

    // Sort so the quantiles are in order
    quantileObjs.sort((a, b) => a.quantile.localeCompare(b.quantile));

    // Then check that the values are also in increasing order - if not save the incorrect quantile
    var outOfOrder = [];
    quantileObjs.forEach(function (quantileObj, i, array) {
      // TODO: This check is specifically for prevalence data but could be done in a more generic way in future
      if (
        row['ValueType'] === 'prevalence' ||
        row['ValueType'] === 'prevalence_mtp'
      ) {
        if (quantileObj.quantileValue < 0 || quantileObj.quantileValue > 100) {
          var quantileError = {};
          var rowNumber = Number(index) + 2; // add 1 to account for zero indexing and 1 to account for header row
          quantileError.message =
            'Quantile ' +
            quantileObj.quantile +
            ' value "' +
            quantileObj.quantileValue +
            '"' +
            ' for prevalence on row number ' +
            rowNumber +
            ' is invalid because it is not a percentage.\n';
          quantileErrors.push(quantileError);
        }
      }

      if (
        !(i === 0 || array[i - 1].quantileValue <= quantileObj.quantileValue)
      ) {
        outOfOrder.push(quantileObj);
      }
    });

    // create an error if any out of order values were found on this row
    if (outOfOrder.length > 0) {
      var quantileError = {};
      var rowNumber = Number(index) + 2; // add 1 to account for zero indexing and 1 to account for header row
      quantileError.message =
        'Quantile value(s) [ ' +
        outOfOrder.map(obj => obj.quantile) +
        '] are incorrect on row ' +
        rowNumber +
        ' values are not in ascending order from the lowest to highest quantile.\n';
      quantileErrors.push(quantileError);
    }
  });

  return quantileErrors;
}

/**
 * Checks that the mandatory value "All" is present for AgeBand values
 *
 * @param {Json} dataPage
 * @param {Array} modelFields
 */
function isAllAgeBandPresent(dataPage, modelFields) {
  var incompleteDataErrors = [];

  if (!modelFields.includes('AgeBand')) {
    return [];
  }

  let idsList = dataPage.reduce((accumulator, row, rowIndex) => {
    return filterAgeBandsFromRow(accumulator, row, rowIndex);
  }, {});

  let ids = Object.keys(idsList);

  for (let i in ids) {
    // check the 'All' ageband exists for each id
    let id = ids[i];
    var idAgeBands = idsList[id];

    if (!idAgeBands.includes('All')) {
      let missingTotalAgeBandError = {};
      missingTotalAgeBandError.details =
        'Data for metric ' +
        id +
        ' is missing AgeBand "All". AgeBand "All" represents the total of all the age bands and is mandatory.\n';
      incompleteDataErrors.push(missingTotalAgeBandError);
    }
  }

  return incompleteDataErrors;
}

/**
 * Check for any non-sequential or duplicate dates
 * @param {*} dataPage  the field value
 */
function checkDates(dataPage) {
  let incompleteDataErrors = [];

  let idsList = dataPage.reduce((accumulator, row, rowIndex) => {
    return filterDatesFromRow(accumulator, row, rowIndex);
  }, {});

  let ids = Object.keys(idsList);

  for (let i in ids) {
    // check values are sequential... hopefully they are still in order!
    let id = ids[i];
    var idDates = idsList[id];

    var duplicates = idDates.reduce(function (acc, el, i, arr) {
      let duplicateDateIndex = arr.findIndex(t => t.date.isSame(el.date));
      if (
        duplicateDateIndex !== i &&
        acc.findIndex(t => t.date.isSame(el.date)) < 0
      ) {
        let duplicate = {};
        duplicate.date = el['date'];
        duplicate.rows = [el['row'], arr[duplicateDateIndex]['row']];
        acc.push(duplicate);
      }
      return acc;
    }, []);

    if (duplicates && duplicates.length > 0) {
      let duplicateDateErrors = duplicates.map(duplicate => {
        let duplicateDateError = {};
        duplicateDateError.details =
          'Entry for date ' +
          duplicate['date'].format('YYYY-MM-DD') +
          ' is duplicated on rows ' +
          duplicate['rows'] +
          '. Please remove one of the duplicate entries.\n';
        incompleteDataErrors.push(duplicateDateError);
      });
    }

    let incompleteDataError = checkDatesSequential(id, idDates);
    if (incompleteDataError) {
      incompleteDataErrors.push(incompleteDataError);
    }
  }

  return incompleteDataErrors;
}

/**
 * Reduce the row object to a date object containing the value date and the row number. Create an id from the creation date,
 * valueType, geography, model and version, and add the date oject to the accumulator under that id.
 *
 * @param {*} accumulator - object that maps ids to a list of date objects
 * @param {*} row - row to process
 * @param {*} index - the index of the row
 */
function filterDatesFromRow(accumulator, row, index) {
  let valueType = row['ValueType'];
  let geography = row['Geography'];
  let model = row['Model'];
  let version = row['Version'];
  let ageBand = row['AgeBand'];
  let scenario = row['Scenario'];
  let dateString =
    padZero('' + row['Year of Value']) +
    '-' +
    padZero('' + row['Month of Value']) +
    '-' +
    padZero('' + row['Day of Value']);
  if (ValidatorUtils.isValidDate(dateString)) {
    let date = moment(dateString);
    let creationDateString =
      row['Creation Year'] +
      '-' +
      row['Creation Month'] +
      '-' +
      row['Creation Day'];
    let id =
      valueType +
      '|' +
      geography +
      '|' +
      ageBand +
      '|' +
      model +
      '|' +
      version +
      '|' +
      creationDateString +
      '|' +
      scenario;

    let dateObj = {};
    dateObj['date'] = date;
    dateObj['row'] = Number(index) + 2; // add 2 - 1 to account for 0-index and one to account for the header row

    accumulator[id] = accumulator[id] || [];
    accumulator[id].push(dateObj);
  }
  return accumulator;
}

/**
 * Reduce the row object to an AgeBand. Create an id from the creation date,
 * valueType, geography, model and version, and add the AgeBand to the accumulator under that id.
 *
 * @param {*} accumulator - object that maps ids to a list of date objects
 * @param {*} row - row to process
 * @param {*} index - the index of the row
 */
function filterAgeBandsFromRow(accumulator, row, index) {
  let valueType = row['ValueType'];
  let geography = row['Geography'];
  let model = row['Model'];
  let version = row['Version'];
  let ageBand = row['AgeBand'];
  let scenario = row['Scenario'];

  let creationDateString =
    row['Creation Year'] +
    '-' +
    row['Creation Month'] +
    '-' +
    row['Creation Day'];
  let id =
    valueType +
    '|' +
    geography +
    '|' +
    model +
    '|' +
    version +
    '|' +
    creationDateString +
    '|' +
    scenario;

  accumulator[id] = accumulator[id] || [];
  accumulator[id].push(ageBand);

  return accumulator;
}

function checkDatesSequential(id, dates) {
  if (dates.length > 1) {
    for (let i in dates) {
      let index = Number(i);
      let date = dates[index];
      var isBetween = true;
      let rows = [];
      if (index === 0) {
        let afterDate = dates[index + 1];
        isBetween = date['date'].isBefore(afterDate['date']);
        rows = [afterDate['row']];
      } else if (index + 1 === dates.length) {
        let beforeDate = dates[index - 1];
        isBetween = date['date'].isAfter(beforeDate['date']);
        rows = [beforeDate['row']];
      } else {
        let beforeDate = dates[index - 1];
        let afterDate = dates[index + 1];
        isBetween = date['date'].isBetween(
          beforeDate['date'],
          afterDate['date']
        );
        rows = [beforeDate['row'], afterDate['row']];
      }
      if (!isBetween) {
        let incompleteDataError = {};
        let row = date['row'];
        incompleteDataError.details =
          'Date ' +
          date['date'].format('YYYY-MM-DD') +
          ' on row ' +
          row +
          ' is not sequential with all or some dates on rows ' +
          rows +
          ' for data type ' +
          id +
          '. Values that have the same ValueType, AgeBand, Model, Version, Creation date and Geography should be in date order.\n';
        return incompleteDataError;
      }
    }
  }
  return undefined;
}

module.exports = Validator;
