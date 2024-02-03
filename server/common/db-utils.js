import mongoose from 'mongoose'
import logger from './logger.js'

async function ConnectMongoDatabase(openFn) {
   const mongodbUri = `mongodb://${process.env.MONGO_ACCOUNT === '' ? '' : process.env.MONGO_ACCOUNT + ':' + process.env.MONGO_PASSWORD + '@'}` +
      `${process.env.MONGO_HOST}:${process.env.MONGO_PORT}/${process.env.MONGO_DB}`
   mongoose.connect(mongodbUri,
      { useNewUrlParser: true, useUnifiedTopology: true, useCreateIndex: true }
   ).catch(error => {
      logger.error(error)
      process.exit(1)
   })
   mongoose.set('useFindAndModify', false)
   const db = mongoose.connection
   db.on('error', function(data) {
      logger.error(data)
   })
   db.once('open', function () {
      logger.info('connected to mongodb')
      if (openFn) {
         openFn()
      }
   })
}

export { ConnectMongoDatabase }
