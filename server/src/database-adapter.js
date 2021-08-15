import mongoose from 'mongoose'
import logger from '../common/logger.js'

function connectMongoDatabase(openFn) {
   mongoose.connect(`mongodb://${process.env.MONGO_HOST}:${process.env.MONGO_PORT}/${process.env.MONGO_DB}`,
      { useNewUrlParser: true, useUnifiedTopology: true, useCreateIndex: true }
   )
   mongoose.set('useFindAndModify', false)
   const db = mongoose.connection
   db.on('error', logger.error.bind(console, 'connection error:'))
   db.once('open', function () {
      logger.info('connected to mongodb')
      if (openFn) {
         openFn()
      }
   })
}

export { connectMongoDatabase }
