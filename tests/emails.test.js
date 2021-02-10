

const Emailer = require('../validator/emailer.js')

jest.setTimeout(3.6e6)

describe('EmailTests', () => {
    test('email-test-1', async () => {
        await emailTest([{
            recipients: ['thomas.dennis@riskaware.co.uk'],
            providerName: 'test',
            bodyText: 'This is a test email (test #1)',
            attachmentFiles: [],
            providerEmails: []
        }])
    })

    test('email-test-2', async () => {
        let N = 10, info = [], item = {
            recipients: ['thomas.dennis@riskaware.co.uk'],
            providerName: 'test',
            bodyText: 'This is a test email (test #2)',
            attachmentFiles: [],
            providerEmails: []
        }

        for (let i = 1; i <= N; i++) { info.push(item) }
        await emailTest(info)
    })

    test('email-test-3', async () => {
        await emailTest([{
            recipients: ['thomas.dennis@riskaware.co.uk'],
            providerName: undefined,
            bodyText: 'This is a test email (test #3)',
            attachmentFiles: ['tests/resources/email-test/nonsense_data.xlsx'],
            providerEmails: []
        }])
    })
})

afterAll(done => {
    Emailer.shutDown() // close nodemailer transport
    done()
})

/**
 * Generic email test logic.
 * 
 * @param {array} infoItems Array of info objects.
 */
async function emailTest(infoItems) {
    for (let info of infoItems) {
        await Emailer.mockSendEmail(
            info.recipients,
            info.providerName,
            info.bodyText,
            info.attachmentFiles,
            {
                info: (text) => { console.log(text) },
                error: (error) => { console.log(error) }
            },
            info.providerEmails
        )
    }
}