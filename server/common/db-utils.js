import mongoose from 'mongoose'
import logger from './logger.js'

async function connectMongoDatabase(openFn) {
   mongoose.connect(`mongodb://${process.env.MONGO_HOST}:${process.env.MONGO_PORT}/${process.env.MONGO_DB}`,
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

export { connectMongoDatabase }
