const nodemailer = require('nodemailer');
const moment = require('moment');

const mockCredentials = {
  host: 'smtp.ethereal.email',
  port: 587,
  auth: {
    // Log in to https://ethereal.email/ to see traffic.
    user: 'jaylan.schneider60@ethereal.email',
    pass: 'tGG2NdVfXXxrDKCv6Y'
  }
};
const FROM_ADDRESS = process.env.NODEMAILER_USER;
let transporter = null;

/**
 * Separate class to handle emailing logic.
 *
 * @author t_dennis
 */
class Emailer {
  /**
   * Set up the nodemailer transporter
   */
  static setup() {
    console.log('Setting up nodemailer transport');
    transporter = nodemailer.createTransport({
      service: process.env.NODEMAILER_SERVICE,
      auth: {
        user: FROM_ADDRESS,
        pass: process.env.NODEMAILER_PASS
      },
      secure: true,
      pool: true
    });
  }

  /**
   * Closes the active nodemailer transport
   */
  static shutDown() {
    console.log('Shutting down nodemailer transport');
    if (transporter !== null) {
      transporter.close();
    }
  }

  /**
   * Return a local date time string
   *
   */
  static getDateTime() {
    let UTC = moment.utc();
    return moment(UTC).local().format('YYYY-MM-DD HH:mm:ss');
  }

  /**
   * Send an email to the given recipient.
   *
   * @param {array} recipients List of email recipients.
   * @param {string} bodyText The body text.
   * @param {array} attachmentFiles List of attachments for this email.
   * @param {array} providerEmails List of email recipients to CC.
   * @param {any} logger The logger from the calling code.
   */
  static async sendEmail(
    recipients,
    providerName,
    bodyText,
    attachmentFiles,
    logger,
    providerEmails = []
  ) {
    const subject = providerName
      ? 'Message from Data Portal to ' +
        providerName +
        ' (' +
        Emailer.getDateTime() +
        ')'
      : 'Message from Data Portal (' + Emailer.getDateTime() + ')';
    const logo = {
      filename: 'logo.png',
      path: 'resources/png/logo.png',
      cid: 'logo' //same cid value as in the html img src
    };
    let attach = attachmentFiles.map(f => {
      return { path: f };
    });
    attach.push(logo);

    Emailer.sleep(2000); // prevent jamming up the email port
    await new Promise((resolve, reject) => {
      transporter.sendMail(
        {
          from: FROM_ADDRESS,
          to: recipients,
          cc: providerEmails,
          subject: subject,
          html:
            bodyText +
            '<p>--</p><a href="https://www.riskaware.co.uk/"><img src="cid:logo" style="width:25%;height:auto;"/></a>',
          attachments: attach
        },
        function (error, info) {
          if (error) {
            reject(error);
          } else {
            logger.info(
              'Email sent: { from: "' +
                FROM_ADDRESS +
                '", to: "' +
                recipients +
                '", subject: "' +
                subject +
                '", body: "' +
                bodyText +
                '", attachments: [' +
                attachmentFiles.map(a => '"' + a.split('/').pop() + '"') +
                ']}'
            );
            resolve(info);
          }
        }
      );
    }).catch(function (error) {
      logger.error(error);
    });
  }

  /**
   * "sends" a mock email using ethereal mail.
   *
   * @param {array} recipients List of email recipients.
   * @param {string} bodyText The body text.
   * @param {array} attachmentFiles List of attachments for this email.
   * @param {array} providerEmails List of email recipients to CC.
   * @param {any} logger The logger from the calling code.
   */
  static async mockSendEmail(
    recipients,
    providerName,
    bodyText,
    attachmentFiles,
    logger,
    providerEmails = []
  ) {
    const subject = providerName
      ? 'Message from Data Portal to ' +
        providerName +
        ' (' +
        Emailer.getDateTime() +
        ')'
      : 'Message from Data Portal (' + Emailer.getDateTime() + ')';
    const mockTransporter = nodemailer.createTransport(mockCredentials);
    const attach = attachmentFiles.map(f => {
      return { path: f };
    });
    attach.push({
      filename: 'logo.png',
      path: 'resources/png/logo.png',
      cid: 'logo' //same cid value as in the html img src
    });
    Emailer.sleep(2000); // prevent jamming up the email port
    await new Promise((resolve, reject) => {
      mockTransporter.sendMail(
        {
          from: FROM_ADDRESS,
          to: recipients,
          cc: providerEmails,
          subject: subject,
          html:
            bodyText +
            '<p>--</p><a href="https://www.riskaware.co.uk/"><img src="cid:logo" style="width:25%;height:auto;"/></a>',
          attachments: attach
        },
        function (error, info) {
          if (error) {
            reject(error);
          } else {
            logger.info(
              'Email sent: { from: "' +
                FROM_ADDRESS +
                '", to: "' +
                recipients +
                '", subject: "' +
                subject +
                '", body: "' +
                bodyText +
                '", attachments: [' +
                attachmentFiles.map(a => '"' + a.split('/').pop() + '"') +
                ']}'
            );
            resolve(info);
          }
        }
      );
    }).catch(function (error) {
      logger.error(error);
      throw error;
    });
  }

  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = Emailer;
