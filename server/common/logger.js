import winston from 'winston'
const format = winston.format

const today = new Date().toISOString().split('T')[0]

const options = {
   file: {
      level: 'info',
      filename: `./log/slackbot-server-${today}.log`,
      handleExceptions: true,
      colorize: false,
   },
   console: {
      level: 'debug',
      handleExceptions: true,
      colorize: true,
   },
}

const myFormat = format.printf(({ level, message, timestamp }) => {
   return `${timestamp} ${level}: ${JSON.stringify(message)}`;
})

const logger = winston.createLogger({
   levels: winston.config.npm.levels,
   format: format.combine(
      format.timestamp(),
      myFormat
   ),
   transports: [
      new winston.transports.File(options.file),
      new winston.transports.Console(options.console)
   ],
   exitOnError: false
})

logger.info(today)

export default logger