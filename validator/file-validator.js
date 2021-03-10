const FileParser = require('../common/file-parser.js');
const FileArchiver = require('../common/file-archiver.js');
const Validator = require('./validator.js');
const Emailer = require('./emailer.js');
const fs = require('fs');
const waitOn = require('wait-on');
const promisify = require('util').promisify;
const mv = require('mv');
const mvPromise = promisify(mv);
let configToUse = '../' + process.env.CONFIG;
let config = require(configToUse);
const logger = require('../common/logger.js');
const { spawn } = require('child_process');
const chokidar = require('chokidar');
const path = require('path');

const test = process.env.NODE_ENV === 'test';
const maxFileAttachmentSizeInMb = config.maxFileAttachmentSizeInMb;
const fileCopyTimeoutInMS = config.fileCopyTimeoutInMins * 60000;
const pollIntervalInMS = config.pollIntervalInMS;
let watcher = null;

/**
 * Watches file locations of provider directories and validates models
 */

/**
 * Start the file validator
 */
async function start() {
  const homeDirs = config.fileWatch.homeDirs;
  const providers = config.providers;
  const optionalFields = config.optionalFields;
  providers.forEach(provider => {
    provider['filePaths'] = [];
    homeDirs.forEach(homeDir => {
      provider.filePaths.push(
        homeDir + '/' + provider.name + '/' + config.fileWatch.triggerFolder
      );
    });
  });
  const providerDirs = providers.map(provider => provider.filePaths);

  logger.trace('Watching provider directories: ' + providerDirs.toString());

  try {
    Emailer.setup();
  } catch (err) {
    logger.error('Error setting up nodemailer transport: ' + err);
  }

  // Create directories if required (Please create these manually for now e.g. /provider-1/validate)
  for (let d in providerDirs) {
    await createProviderDirectories(providerDirs[d]);
  }

  // Copy case data file if needed
  let caseDataRoot = '/' + config.fileWatch.rCaseDataFolder;
  if (fs.existsSync(caseDataRoot) && fs.readdirSync(caseDataRoot).length > 0) {
    let caseDataHome = 'R/' + config.fileWatch.rTempFolder + caseDataRoot;
    await FileParser.createDirectory(caseDataHome).catch(err => {
      logger.error('file parsing: ' + err);
    });

    for (let file in fs.readdirSync(caseDataRoot)) {
      await FileParser.copy(
        caseDataRoot + '/' + file,
        caseDataHome + '/' + file
      ).catch(err => {
        logger.error('file parsing: ' + err);
      });
    }
  }

  // before we start, check each provider dir for existing files and process them
  for (let dirs in providerDirs) {
    let dirPaths = providerDirs[dirs];
    for (let dir in dirPaths) {
      const directory = dirPaths[dir];
      logger.info('Check directory ' + directory);
      let dataFiles = fs.readdirSync(directory);
      for (let file in dataFiles) {
        const fileName = dataFiles[file];
        const filePath = directory + '/' + fileName;
        if (fs.lstatSync(filePath).isFile()) {
          if (fileName.endsWith('.csv') || fileName.endsWith('.xlsx')) {
            logger.info('Found existing file ' + filePath);
            processModel(filePath, homeDirs, providers, optionalFields);
          } else {
            processIncorrectFileType(
              filePath,
              homeDirs,
              providers,
              optionalFields
            );
          }
        }
      }
    }
  }

  watcher = chokidar.watch(providerDirs, {
    persistent: true,
    alwaysStat: false,
    depth: 0, // Only watch for files in the validate folder and not subfolders
    usePolling: true,
    interval: pollIntervalInMS,
    binaryInterval: pollIntervalInMS,
    awaitWriteFinish: {
      stabilityThreshold: 3000,
      pollInterval: 100
    }
  });

  watcher.on('add', async function (path) {
    try {
      if (path.endsWith('.csv') || path.endsWith('.xlsx')) {
        logger.info('New file detected: ' + path);
        // Wait for file to finish copying/uploading, timeout after specified time
        try {
          await waitOn({
            resources: [path],
            timeout: fileCopyTimeoutInMS,
            simultaneous: 1
          });
          // Process the model
          logger.info('File is ready for parsing: ' + path);
          processModel(path, homeDirs, providers, optionalFields);
        } catch (err) {
          logger.error('File upload not complete: ' + err);
        }
      } else {
        processIncorrectFileType(path, homeDirs, providers, optionalFields);
      }
    } catch (error) {
      logger.error('Validating file: ' + path + ' - ' + error);
    }
  });

  // Set the max event listeners to 20, default is 10
  watcher.setMaxListeners(20);

  // Log any watcher errors
  watcher.on('error', function (err) {
    logger.error('watching file location: ' + err);
  });
}

/**
 * Process the model and perform validation if required
 * @param {*} path the path of the model
 * @param {*} homeDirs the home directories
 * @param {*} providers the providers and their information
 * @param {*} optionalFields the optional model fields
 * @param {*} validationMessage the current validation message
 */
async function processModel(
  path,
  homeDirs,
  providers,
  optionalFields,
  validationMessage = {}
) {
  // Make all backslashes forward slashes for compatibility
  let filePath = path.replace(/\\/g, '/');

  // Get the home path where the file was uploaded
  let homeDir = getHomePathFromPath(filePath, homeDirs);

  // Read in the templates and use the first one if there are multiple
  let templatePath = homeDir + '/' + config.fileWatch.templateFolder;
  let templates = fs.readdirSync(templatePath);
  let combinedDataTemplate = templates.filter(t =>
    t.startsWith('CombinedDataTemplate_')
  );
  let bestRDataTemplate = templates.filter(t =>
    t.startsWith('BestRDataTemplate_')
  );

  // Read the model
  logger.info('parsing file: ' + path);
  const model = await FileParser.parse(filePath).catch(err => {
    logger.error('file parsing: ' + err);
    const errString = err.toString();
    if (
      errString.includes('Excel supports columns from 1 to') ||
      errString.includes('Row length does not match headers')
    ) {
      let errors = {};
      errors['columnLimit'] = err;
      validationMessage['hasErrors'] = true;
      validationMessage.errors = errors;
    }
  });
  logger.info('finished parsing: ' + filePath);

  if (!validationMessage.hasErrors) {
    // Read the model headers - assumes either the fields sheet is present first, or uses the actual template headers
    const modelHeaders = Validator._getHeader(model[Object.keys(model)[0]]);
    // Check for the 'Generation Process' header which indicates this model file is a R best estimate (TODO how could this check be more robust?)
    const isBestREstimateFile = modelHeaders.includes('Generation Process');

    // Choose the relevant template
    let templateToUse = isBestREstimateFile
      ? bestRDataTemplate
      : combinedDataTemplate;
    const template = await FileParser.parse(
      templatePath + '/' + templateToUse
    ).catch(err => {
      logger.error('file parsing: ' + err);
    });

    // Pull out the required data sheet
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

    // Validate the model
    logger.info('validating file....');
    validationMessage = await Validator.validate(
      dataPage,
      template['Template_2'],
      template['Fields_1'],
      optionalFields
    ).catch(err => {
      logger.error('Validating: ' + err);
    });
    logger.info('Model has been validated: ' + path);
  }

  // Lookup email for the provider.
  const uploadFolderUsed = filePath.substring(0, filePath.lastIndexOf('/'));
  let provider;
  for (let p in providers) {
    let candidateProvider = providers[p];
    for (let f in candidateProvider.filePaths) {
      if (
        candidateProvider.filePaths[f] === uploadFolderUsed &&
        candidateProvider.name !== ''
      ) {
        provider = candidateProvider;
      }
    }
  }

  let providerRecipients = provider.emails.join(',');
  let workingGroupRecipients = config.workingGroup.join(',');
  let resultsFilePath = '';
  let errorSummary = '';

  // Determine path for validation output
  if (validationMessage.hasErrors) {
    resultsFilePath = filePath.replace(
      config.fileWatch.triggerFolder,
      'invalid'
    );
  } else {
    resultsFilePath = filePath.replace(config.fileWatch.triggerFolder, 'valid');
  }

  // Determine path to save error file
  let fileNameWithoutExtension = filePath.substring(
    filePath.lastIndexOf('/') + 1,
    filePath.lastIndexOf('.')
  );
  let fileNameWithExtension = filePath.split('/').pop();
  let errorPath = resultsFilePath.replace(
    fileNameWithExtension,
    fileNameWithoutExtension + '-errors.txt'
  );

  if (validationMessage.hasErrors) {
    // Write error message
    errorSummary = await writeErrorMessage(validationMessage, errorPath);
  }

  // Create directory for validation history and determine the paths to copy the results files from
  let date = new Date().toJSON().slice(0, 10);
  let validationHistoryDir =
    homeDir + '/validation-history/' + provider.name + '/' + date;
  let modelValidationHistory =
    validationHistoryDir + '/' + fileNameWithExtension;
  let errorValidationHistory =
    validationHistoryDir + '/' + errorPath.split('/').pop();

  // Create validation history directory if needed
  await createDirectory(validationHistoryDir);

  if (validationMessage.hasErrors) {
    // Move the model to the correct folder for the provider
    await mvPromise(filePath, resultsFilePath, { mkdirp: true })
      .then(() => {
        fs.createReadStream(resultsFilePath).pipe(
          fs.createWriteStream(modelValidationHistory)
        );
        fs.createReadStream(errorPath).pipe(
          fs.createWriteStream(errorValidationHistory)
        );
      })
      .catch(err => {
        logger.error('moving file: ' + err);
      });

    // Send invalid submission email
    await sendInvalidSubmissionEmail(
      providerRecipients,
      provider,
      fileNameWithExtension,
      errorSummary,
      errorPath
    );
  } else {
    // Calculate Plots
    let rResultsFolder = 'R/' + config.fileWatch.rTempFolder;
    // Replace any spaces so we don't have issues passing as an argument to the R process
    let rFilename = fileNameWithExtension.replace(/ /g, '_');
    let plotsBody = [];
    if (config.fileWatch.rCalculatePlots) {
      let rPathToModelFile =
        rResultsFolder +
        '/' +
        config.fileWatch.rForecastFolder +
        '/' +
        rFilename;

      await mvPromise(filePath, rPathToModelFile, { mkdirp: true }).catch(
        err => {
          logger.error('Moving file: ' + err);
        }
      );
      logger.info('calculating plots: ' + rPathToModelFile);
      await calculatePlots(
        rFilename,
        rResultsFolder,
        rPathToModelFile,
        resultsFilePath,
        validationHistoryDir,
        plotsBody
      ).catch(err => {
        logger.error('calculating plots for ' + rFilename + ' : ' + err);
      });
    } else {
      logger.warn('Skipping calculating plots as bat file not specified');
      await mvPromise(filePath, resultsFilePath, { mkdirp: true }).catch(
        err => {
          logger.error('Moving file: ' + err);
        }
      );
    }

    // Send emails
    await prepareAndSendEmails(
      resultsFilePath,
      fileNameWithExtension,
      plotsBody,
      filePath,
      provider,
      providerRecipients,
      workingGroupRecipients,
      validationHistoryDir
    );
    // Copy model file to validation history
    fs.createReadStream(resultsFilePath).pipe(
      fs.createWriteStream(modelValidationHistory)
    );
  }
}

/**
 * Prepare and send emails to providers and working group
 * @param {*} resultsFilePath The filepath of the results
 * @param {*} fileNameWithExtension the file name of the results with extension
 * @param {*} plotsBody the plotsbody for email
 * @param {*} filePath the file path of the submission
 * @param {*} provider the provider object
 * @param {*} providerRecipients the provider emails addresses
 * @param {*} workingGroupRecipients the working group email addresses
 * @param {*} validationHistoryDir the validation history directory
 */
async function prepareAndSendEmails(
  resultsFilePath,
  fileNameWithExtension,
  plotsBody,
  filePath,
  provider,
  providerRecipients,
  workingGroupRecipients,
  validationHistoryDir
) {
  // Read the file size
  let fileSize = await FileArchiver.readFileSizeInMb(resultsFilePath);

  // Zip the model if size is too big. 25mb is the current gmail limit
  if (fileSize >= maxFileAttachmentSizeInMb) {
    logger.info(
      'model size is ' + fileSize + 'mb. Zipping file before emailing'
    );
    let zipPath = resultsFilePath.replace(
      resultsFilePath.substr(resultsFilePath.lastIndexOf('.') + 1),
      'zip'
    );
    await FileArchiver.writeAsZip(
      resultsFilePath,
      fileNameWithExtension,
      zipPath
    ).catch(err => {
      logger.error('saving file to zip: ' + err);
    });

    // Wait for file to finish zipping, timeout after specified time
    try {
      await waitOn({
        resources: [zipPath],
        timeout: fileCopyTimeoutInMS,
        simultaneous: 1
      });
    } catch (err) {
      logger.error('file zip timeout: ' + err);
    }

    // Copy zip file to validation history
    fs.createReadStream(zipPath).pipe(
      fs.createWriteStream(
        validationHistoryDir + '/' + zipPath.split('/').pop()
      )
    );

    // Check if the zip file size is now acceptable
    let zipFileSize = await FileArchiver.readFileSizeInMb(zipPath);
    let zipFileName = zipPath.split('/').pop();
    if (zipFileSize < maxFileAttachmentSizeInMb) {
      await sendValidSubmissionEmail(
        plotsBody,
        zipPath,
        filePath,
        provider,
        providerRecipients,
        workingGroupRecipients,
        zipFileName
      );

      // Send an extra email to the working group in case firewalls block zip files
      if (workingGroupRecipients.length > 0) {
        let message = createMessage(
          'working group',
          'A model has been submitted for processing: ' + zipFileName,
          'A second email containing the above zip file has been sent. Please note that your firewall may have blocked the attached zip file'
        );
        await sendEmail(workingGroupRecipients, undefined, message, [], logger);
      }
    } else {
      // Send out emails to model providers that the model is too big for submission
      logger.error(
        'model after zipping is still too big (' +
          zipFileSize +
          'mb) to send, maxiumum is ' +
          maxFileAttachmentSizeInMb +
          'mb'
      );
      let message = createMessage(
        provider.name + ' model provider',
        'Validation complete with no errors, but failed to submit for further processing',
        'Model size (zipped) is ' +
          zipFileSize +
          'mb. Limit for email attachment is ' +
          maxFileAttachmentSizeInMb +
          'mb'
      );
      await sendEmail(providerRecipients, provider.name, message, [], logger);
    }
  } else {
    let modelName = filePath.split('/').pop();
    await sendValidSubmissionEmail(
      plotsBody,
      resultsFilePath,
      filePath,
      provider,
      providerRecipients,
      workingGroupRecipients,
      modelName
    );
  }
}

/**
 * Prepare and sends emails of validation results
 * @param {*} plotsBody the R plots if present
 * @param {*} resultsFilePath the file path model after validation
 * @param {*} filePath the file path of the model as submitted for validation
 * @param {*} provider the model provider that submitted this model for validation
 * @param {*} providerRecipients the provider email recipients
 * @param {*} workingGroupRecipients working group email addresses
 * @param {*} modelName the model name
 */
async function sendValidSubmissionEmail(
  plotsBody,
  resultsFilePath,
  filePath,
  provider,
  providerRecipients,
  workingGroupRecipients,
  modelName
) {
  // Log validation success
  let logMessage =
    'Validation complete on file "' +
    filePath.split('/').pop() +
    '", there are no validation errors in model';
  logger.info(logMessage);

  // Send email to the provider & include succesful validation message.
  if (provider && providerRecipients.length > 0) {
    // Create plots text
    let attachmentText = 'File has been submitted for processing';
    if (plotsBody && plotsBody.length > 0) {
      attachmentText += ', please see the plots data attached';
    }

    // Create full message and send email
    let message = createMessage(
      provider.name + ' model provider',
      logMessage,
      attachmentText
    );
    await sendEmail(
      providerRecipients,
      provider.name,
      message,
      plotsBody,
      logger
    );
  }
  // Send email to the working group
  if (provider && workingGroupRecipients.length > 0) {
    let message = createMessage(
      'working group',
      'A model has been submitted for processing: ' + modelName,
      'Please see the file attachement'
    );
    await sendEmail(
      workingGroupRecipients,
      undefined,
      message,
      [resultsFilePath, ...plotsBody],
      logger
    );
  }
}

/**
 * Send an invalid submission email
 * @param {*} providerRecipients the provider respient email addresses
 * @param {*} provider  the provider object
 * @param {*} fileNameWithExtension the file name with extension
 * @param {*} errorSummary the errory summary
 * @param {*} errorPath the file path of the error text file to include as an attachement
 */
async function sendInvalidSubmissionEmail(
  providerRecipients,
  provider,
  fileNameWithExtension,
  errorSummary,
  errorPath
) {
  let logMessage =
    'Validation complete on file "' +
    fileNameWithExtension +
    '", there are validation errors in model';
  logger.info(logMessage);

  let summaryBody = '';
  for (const item in errorSummary) {
    if (Object.prototype.hasOwnProperty.call(errorSummary, item)) {
      summaryBody = summaryBody + '<p>' + errorSummary[item] + '</p>';
    }
  }
  let message = createMessage(
    provider.name + ' model provider',
    logMessage,
    summaryBody
  );

  // Send email to provider including the validation errors including the errorSummary message
  if (provider && providerRecipients.length > 0) {
    logger.info('Sending invalid submission email');
    await sendEmail(
      providerRecipients,
      provider.name,
      message,
      [errorPath],
      logger
    );
  }
}

/**
 * Process R plot results
 * @param {*} rResultsFolder the R results folder
 * @param {*} validationHistoryDir the validation history dir for this model file
 * @param {*} fileName the pdf results file name
 * @param {*} resultsFilePath a the R results for this model
 * @param {*} plotsBody the plot files to attach to the email
 */
async function processPlotsResults(
  rResultsFolder,
  validationHistoryDir,
  fileName,
  resultsFilePath,
  plotsBody
) {
  const pdfResultsinRFolder = path.resolve(rResultsFolder, fileName);
  const pdfResultsInValidFolder =
    resultsFilePath.substring(0, resultsFilePath.lastIndexOf('/')) +
    '/' +
    fileName;
  const pdfResultsInValidationHistoryFolder =
    validationHistoryDir + '/' + fileName;

  logger.info(
    'Moving R pdf results file: ' +
      pdfResultsinRFolder +
      ' to ' +
      pdfResultsInValidFolder +
      ' and ' +
      pdfResultsInValidationHistoryFolder
  );

  plotsBody.push(pdfResultsInValidFolder);

  await mvPromise(pdfResultsinRFolder, pdfResultsInValidFolder, {
    mkdirp: true
  })
    .then(() => {
      // Copy model file to validation history
      fs.createReadStream(pdfResultsInValidFolder).pipe(
        fs.createWriteStream(pdfResultsInValidationHistoryFolder)
      );
    })
    .catch(err => {
      logger.error('Moving file: ' + err);
    });
}

/**
 * Create a generic message
 * @param {*} recipientName whom the message is addressed to
 * @param {*} heading the heading of the message
 * @param {*} mainBody the message itself
 */
function createMessage(recipientName, heading, mainBody) {
  return (
    '<p>Dear ' +
    recipientName +
    ',</p><h3>' +
    heading +
    '</h3><p>' +
    mainBody +
    '</p>'
  );
}

/**
 * Derive the home directory of the filepath
 * @param {*} filePath the filepath
 * @param {*} homeDirs the home directories
 */
function getHomePathFromPath(filePath, homeDirs) {
  for (let i in homeDirs) {
    let homeDir = homeDirs[i];
    if (filePath.includes(homeDir)) {
      return homeDir;
    }
  }
}

/**
 * Process files that have the incorrect file type
 * @param {*} path the path of the file
 * @param {*} homeDirs home directories
 * @param {*} providers the provider details
 * @param {*} optionalFields the optional fields
 */
async function processIncorrectFileType(
  path,
  homeDirs,
  providers,
  optionalFields
) {
  logger.error('Unsupported file - skipping validation: ' + path);
  let errors = {};
  let validationMessage = {};
  errors['unsupportedFileType'] = path.split('/').pop();
  validationMessage['hasErrors'] = true;
  validationMessage.errors = errors;
  processModel(path, homeDirs, providers, optionalFields, validationMessage);
}

/**
 * Calculates plots for a given forecast file
 * @param {string} outputFileName The file name of the model to plot
 * @param {string} rResultsFolder  the r results folder
 * @param {string} rPathToModelFile the path of the model file when being processed by the R script
 * @param {string} resultsFilePath the valid folder path to move the model back to
 * @param {string} validationHistoryDir the validation history directiory to copy the model and results too
 * @param {string} plotsBody the plots to attach to email
 */
async function calculatePlots(
  outputFileName,
  rResultsFolder,
  rPathToModelFile,
  resultsFilePath,
  validationHistoryDir,
  plotsBody
) {
  return new Promise(async function (resolve, reject) {
    try {
      let cmd =
        '"' +
        config.fileWatch.rCalculatePlots +
        '" ' +
        config.fileWatch.rTempFolder +
        ' ' +
        outputFileName;
      logger.info('R command line: ' + cmd);
      console.log('"' + config.fileWatch.rCalculatePlots + '"');
      console.log('"' + config.fileWatch.rTempFolder + '"', outputFileName);
      const plots = spawn(
        config.fileWatch.rCalculatePlots,
        ['"' + config.fileWatch.rTempFolder + '"', outputFileName],
        { cwd: 'R/' },
        { shell: true }
      );

      plots.on('error', error => {
        reject(error);
      });

      plots.stdout.on('data', function (data) {
        console.log('stdout: ' + data);
      });

      plots.stderr.on('data', function (data) {
        console.log('stderr: ' + data);
      });

      plots.on('close', async function (code) {
        console.log('child process exited with code ' + code);
        logger.info(
          'Finishing plotting file: ' +
            outputFileName +
            ' with exit code: ' +
            code
        );

        if (code === 0) {
          let dataFiles = fs.readdirSync(rResultsFolder);
          for (let file in dataFiles) {
            const fileName = dataFiles[file];
            if (fileName.endsWith('.pdf')) {
              const fileNameWithoutExtension = outputFileName.substring(
                0,
                outputFileName.lastIndexOf('.')
              );
              if (fileName.includes(fileNameWithoutExtension)) {
                processPlotsResults(
                  rResultsFolder,
                  validationHistoryDir,
                  fileName,
                  resultsFilePath,
                  plotsBody
                );
              }
            }
          }
        }

        await mvPromise(rPathToModelFile, resultsFilePath, { mkdirp: true })
          .then(() => {
            resolve(code);
          })
          .catch(err => {
            reject(err);
          });
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Create provider directories if needed
 * @param {Object} providers
 */
async function createProviderDirectories(providers) {
  for (let i in providers) {
    await createDirectory(providers[i]);
  }
}

/**
 * Create directory using promises
 * @param {String} dir
 */
async function createDirectory(dir) {
  return await fs.promises.mkdir(dir, { recursive: true }, err => {
    if (err) {
      logger.error('creating directory: ' + err);
    }
  });
}

/**
 * Write error messsage to file
 * @param {Object} validationMessage
 * @param {String} errorPath
 */
async function writeErrorMessage(validationMessage, errorPath) {
  // Write the directory for the valid / invalid folder
  let validityDir = errorPath.substring(0, errorPath.lastIndexOf('/'));
  await createDirectory(validityDir);

  let errorSummary = '';
  let errorMessage = fs.createWriteStream(errorPath, function (err) {
    if (err) {
      logger.error('writing file: ' + err);
    }
  });
  try {
    let noData = validationMessage.errors.noData;
    let columnLimit = validationMessage.errors.columnLimit;
    let unsupportedFileType = validationMessage.errors.unsupportedFileType;

    if (noData) {
      errorSummary = [];
      errorSummary.push(
        'There is no data in this file. Please note if the .xlsx file contains multiple sheets, the data is should be contained on the last sheet in the file.'
      );
      errorMessage.write('Validation complete. ' + errorSummary + '\n');
    } else if (columnLimit) {
      errorSummary = [];
      errorSummary.push(
        'This file contains at least one row that has more values than there are columns. Please check that rows are formatted correctly and match the number of columns expected in the template.'
      );
      errorMessage.write('Validation complete. ' + errorSummary + '\n');
    } else if (unsupportedFileType) {
      errorSummary = [];
      errorSummary.push(
        'The validator does not support this file type. Please upload only .xlsx or .csv files.'
      );
      errorMessage.write(
        'Validation skipped for this file. ' + errorSummary + '\n'
      );
    } else {
      let missingFields = validationMessage.errors.missingFields;
      let unrecognisedFields = validationMessage.errors.unrecognisedFields;
      let incorrectFieldValues = validationMessage.errors.incorrectFieldValues;
      let dateErrors = validationMessage.errors.dateErrors;
      let incompleteDataErrors = validationMessage.errors.incompleteDataErrors;
      let quantileErrors = validationMessage.errors.quantileErrors;
      let emptyColumnsIndexes = validationMessage.errors.emptyColumnsIndexes;

      // Return error summary early if there are missing or unrecognised fields
      if (missingFields.length > 0 || unrecognisedFields.length > 0) {
        errorSummary = [];
        errorSummary.push(
          'There are ' +
            missingFields.length +
            ' missing fields, ' +
            unrecognisedFields.length +
            ' unrecognised fields and ' +
            emptyColumnsIndexes.size +
            ' empty column(s) present. Please ensure that these field errors are corrected so that the data in this file can be validated.' +
            '\n'
        );
        errorMessage.write('Validation complete. ' + errorSummary);

        // Write missing fields error message
        if (missingFields.length > 0) {
          errorMessage.write(
            'Missing fields: ' + missingFields.join(', ') + '.\n'
          );
          errorSummary.push('Missing fields: ' + missingFields.join(', '));
        }

        // Write missing fields error message
        if (unrecognisedFields.length > 0) {
          errorMessage.write(
            'Unrecognised fields: ' + unrecognisedFields.join(', ') + '.\n'
          );
          errorSummary.push(
            'Unrecognised fields: ' + unrecognisedFields.join(', ')
          );
        }

        // Write missing columns message
        emptyColumnsIndexes.forEach(colIndex => {
          let nonZeroIndex = parseInt(colIndex) + 1;
          errorMessage.write(
            'Column ' + nonZeroIndex + ' appears to be empty.\n'
          );
          errorSummary.push('Column ' + nonZeroIndex + ' appears to be empty.');
        });

        // Close write stream
        errorMessage.end();

        return errorSummary;
      }
      // Write initial error line
      errorSummary = [];
      errorSummary.push(
        'There are ' +
          missingFields.length +
          ' missing fields, ' +
          unrecognisedFields.length +
          ' unrecognised fields, ' +
          dateErrors.length +
          ' invalid date errors, ' +
          incompleteDataErrors.length +
          ' non-squential or duplicate date errors, ' +
          incorrectFieldValues.length +
          ' incorrect field values and ' +
          quantileErrors.length +
          ' incorrect quantile errors.'
      );
      errorMessage.write('Validation complete. ' + errorSummary + '\n');

      // Write missing fields error message
      if (missingFields.length > 0) {
        errorMessage.write(
          'Missing fields: ' + missingFields.join(', ') + '.\n'
        );
        errorSummary.push('Missing fields: ' + missingFields.join(', '));
      }

      // Write missing fields error message
      if (unrecognisedFields.length > 0) {
        errorMessage.write(
          'Unrecognised fields: ' + unrecognisedFields.join(', ') + '.\n'
        );
        errorSummary.push(
          'Unrecognised fields: ' + unrecognisedFields.join(', ')
        );
      }

      // Write date error messages
      if (dateErrors.length > 0) {
        for (let d in dateErrors) {
          let dateError = dateErrors[d];
          let message =
            'Invalid date: ' +
            dateError.details['Day'] +
            '/' +
            dateError.details['Month'] +
            '/' +
            dateError.details['Year'] +
            ' on row ' +
            dateError.row +
            '.\n';
          errorMessage.write(message);
          errorSummary.push(message);
        }
      }

      // Write incomplete data message
      if (incompleteDataErrors.length > 0) {
        for (let i in incompleteDataErrors) {
          let incompleteError = incompleteDataErrors[i];
          let message = incompleteError.details;
          errorMessage.write(message);
          errorSummary.push(message);
        }
      }

      // Write quantile error message
      if (quantileErrors.length > 0) {
        for (let i in quantileErrors) {
          let quantileError = quantileErrors[i];
          let message = quantileError.message;
          errorMessage.write(message);
          errorSummary.push(message);
        }
      }

      if (incorrectFieldValues.length > 0) {
        let aggregatedValues = {};
        let extraInfoErrors = {};
        errorSummary.push('Incorrect field values:');
        // Write incorrect field value error messages
        for (let i in incorrectFieldValues) {
          let error = incorrectFieldValues[i];
          let fieldValue = error.fieldValue;
          let hasExtraInfo = error.extraInfo !== undefined;
          if (hasExtraInfo) {
            if (
              !Object.prototype.hasOwnProperty.call(
                extraInfoErrors,
                error.extraInfo
              )
            ) {
              extraInfoErrors[error.extraInfo] = 1;
            } else {
              extraInfoErrors[error.extraInfo] += 1;
            }
          } else if (
            !Object.prototype.hasOwnProperty.call(aggregatedValues, fieldValue)
          ) {
            let values = {
              count: 0,
              errorField: error.field
            };
            aggregatedValues[fieldValue] = values;
          } else {
            aggregatedValues[fieldValue].count =
              aggregatedValues[fieldValue].count + 1;
          }

          let errorMsg =
            'Value "' +
            fieldValue +
            '" on row ' +
            error.row +
            ' for field "' +
            error.field +
            '" is not valid' +
            (error.extraInfo !== undefined ? error.extraInfo : '.') +
            '\n';
          if (fieldValue === 'blank') {
            errorMsg =
              'Missing value on row ' +
              error.row +
              ' for field "' +
              error.field +
              '"\n';
          }
          errorMessage.write(errorMsg);
        }
        for (const item in aggregatedValues) {
          let errorSummaryStr =
            aggregatedValues[item].count +
            ' instances of invalid value "' +
            item +
            '" for field ' +
            aggregatedValues[item].errorField;
          if (item === 'blank') {
            errorSummaryStr =
              aggregatedValues[item].count +
              ' instances of a missing value for field ' +
              aggregatedValues[item].errorField;
          }
          errorSummary.push(errorSummaryStr);
        }

        // Add summary of extra info errors
        for (const item in extraInfoErrors) {
          let errorSummaryStr =
            extraInfoErrors[item] +
            ' instances of invalid value' +
            (1 < extraInfoErrors[item] ? 's' : '') +
            item;
          errorSummary.push(errorSummaryStr);
        }
      }
    }
  } catch (err) {
    // Log any validation error message errors
    logger.error('creating validation error message: ' + err);
  } finally {
    // Close write stream
    errorMessage.end();
  }
  return errorSummary;
}

/**
 * Stops the file validator & stops the nodemailer transport
 */
async function stop() {
  if (watcher !== null) {
    watcher.close();
  }
  Emailer.shutDown();
}

if (test) {
  module.exports = { start, stop };
  config = require('../tests/config-automated-tests.json');
  sendEmail = Emailer.mockSendEmail;
} else {
  // autostart the filewatcher
  sendEmail = Emailer.sendEmail;
  module.exports = start();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
