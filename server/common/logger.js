import winston from 'winston'
const format = winston.format

const today = new Date().toISOString().split('T')[0]

const myFormat = format.printf((info) => {
   if (info.stack) {
      return `${info.timestamp} ${info.level}: ${info.message} - ${info.stack}`
   } else {
      return `${info.timestamp} ${info.level}: ${info.message}`
   }
})

const options = {
   file: {
      level: 'debug',
      filename: `/slackbot/log/slackbot-server-${today}.log`,
      handleExceptions: true
   },
   console: {
      level: 'debug',
      handleExceptions: true,
      format: format.combine(
         format.colorize({ all: true })
      )
   }
}

const logger = winston.createLogger({
   levels: winston.config.npm.levels,
   transports: [
      new winston.transports.File(options.file),
      new winston.transports.Console(options.console)
   ],
   format: format.combine(
      format.errors({ stack: true }),
      format.timestamp(),
      myFormat
   ),
   exitOnError: false
})

logger.info(today)

export default logger
