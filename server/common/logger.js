import winston from 'winston'

const today = new Date().toISOString().split('T')[0]

const options = {
   file: {
      level: 'info',
      filename: `./log/slackbot-server-${today}.log`,
      handleExceptions: true,
      json: true,
      colorize: false,
   },
   console: {
      level: 'debug',
      handleExceptions: true,
      json: false,
      colorize: true,
   },
}

const logger = winston.createLogger({
   levels: winston.config.npm.levels,
   transports: [
      new winston.transports.File(options.file),
      new winston.transports.Console(options.console)
   ],
   exitOnError: false
})

logger.info(today)

export default logger