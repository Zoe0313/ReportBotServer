import winston from 'winston'

const options = {
   file: {
      level: 'info',
      filename: './log/slackbot-server.log',
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

export default logger