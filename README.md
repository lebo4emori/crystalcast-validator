# CrystalCast Data Validator
Watches provider folders for models and performs basic validation against a template. Results are emailed to prospective providers and the working group.

## Tools
The following tools are required for development:

### Node
https://nodejs.org/

### Visual Studio Code
https://code.visualstudio.com/

### R
https://www.r-project.org/

Suggested extensions: Jest, Prettify JSON, Rainbow CSV, ESLint, Git.

## Setup
Edit the values in config.json as required. In addition, add credentials for a valid email account into environment variables:
```bash
set NODEMAILER_SERVICE=gmail
set NODEMAILER_USER=username
set NODEMAILER_PASS=password
```
In the /R folder, run the following command to download the dependencies needed for the R plotting script:
```
Rscript requirements.R
```
## Install and run
```bash
npm install
npm run validator
```
or alternatively:

```bash
startup.bat
```
## For manual testing
Recommended during development to prevent validation emails going out to users.
```bash
startup-test.bat
```
## For testing the generation of R plots manually
Put a forecast model in R/TempFolder/Forecast Data and run (found in the R folder):
```
calculate-plots.bat
```
## Running automated tests
```bash
npm run test
```
Run a single test file (filename.test.js):
```bash
npm run test filename
```
Run a single test:
```bash
npm run test -- -t "test-name"
```

## Run tests with coverage
```bash
npm run coverage
```

## Obtain licence report
```bash
npm run licences
```