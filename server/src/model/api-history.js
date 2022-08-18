import mongoose from 'mongoose'
import logger from '../../common/logger.js'

const API_HISTORY_STATUS = {
   SUCCEED: 'SUCCEED',
   FAILED: 'FAILED',
   NOAUTH: 'NOAUTH',
   PENDING: 'PENDING'
}

const SlackbotApiHistorySchema = new mongoose.Schema({
   creator: { type: String, immutable: true },
   conversation: { type: String, immutable: true },
   sendTime: { type: Date, required: true, immutable: true },
   content: { type: String, immutable: true },
   status: { type: String, enum: Object.values(API_HISTORY_STATUS), required: true },
   errorMsg: { type: String, immutable: true },
   ipAddress: { type: String, immutable: true }
}, { timestamps: true })

const SlackbotApiHistory = mongoose.model('api_history', SlackbotApiHistorySchema)

const AddApiHistoryInfo = async (state, request, response) => {
   let _errorMsg = ''
   let _status = API_HISTORY_STATUS.PENDING
   if (response.status === 200) {
      _status = API_HISTORY_STATUS.SUCCEED
   } else {
      _status = response.status === 401 ? API_HISTORY_STATUS.NOAUTH : API_HISTORY_STATUS.FAILED
      _errorMsg = `send message by rest-api error due to: ${response.body.message}`
   }
   const apiHistory = new SlackbotApiHistory({
      creator: state.userId,
      conversation: request.channel,
      sendTime: new Date(),
      content: request.text,
      errorMsg: _errorMsg,
      ipAddress: state.ipAddr,
      status: _status
   })
   apiHistory.save().then(res => {
      logger.info(`save api history ${res} in db`)
   }).catch(error => {
      logger.error(`save api history in db failed: `, error)
   })
}

export { SlackbotApiHistory, API_HISTORY_STATUS, AddApiHistoryInfo }
