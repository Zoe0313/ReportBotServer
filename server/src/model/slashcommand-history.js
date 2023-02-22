import mongoose from 'mongoose'

const SLASH_COMMAND_HISTORY_STATUS = {
   SUCCEED: 'SUCCEED',
   FAILED: 'FAILED',
   TIMEOUT: 'TIMEOUT'
}

const SlashCommandHistorySchema = new mongoose.Schema({
   command: { type: String, required: true, immutable: true },
   creator: { type: String, required: true, immutable: true },
   conversation: { type: String, required: true, immutable: true },
   sendTime: {
      type: Date,
      required: function(v) {
         return this.status === SLASH_COMMAND_HISTORY_STATUS.SUCCEED
      }
   },
   errorMsg: {
      type: String,
      required: function(v) {
         return this.status !== SLASH_COMMAND_HISTORY_STATUS.SUCCEED
      }
   },
   status: { type: String, enum: Object.values(SLASH_COMMAND_HISTORY_STATUS), required: true }
}, { timestamps: true })

const SlashCommandHistory = mongoose.model('slashcommand_histories', SlashCommandHistorySchema)

export { SLASH_COMMAND_HISTORY_STATUS, SlashCommandHistory }
