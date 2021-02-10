const log4js = require('log4js')

log4js.configure({
    appenders: { validator: { type: 'file', filename: 'validation.log' } },
    categories: { default: { appenders: ['validator'], level: 'all' } }
})

const logger = log4js.getLogger('validator')

module.exports = logger