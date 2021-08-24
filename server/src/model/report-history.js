import mongoose from 'mongoose'

const REPORT_HISTORY_STATUS = {
   SUCCEED: 'SUCCEED',
   FAILED: 'FAILED',
   TIMEOUT: 'TIMEOUT',
   PENDING: 'PENDING'
}

const ReportHistorySchema = new mongoose.Schema({
   reportConfigId: { type: mongoose.ObjectId, required: true, immutable: true },
   title: { type: String, required: true, immutable: true },
   creator: { type: String, required: true, immutable: true },
   reportType: { type: String, required: true, immutable: true },
   conversations: { type: [String], required: true, immutable: true },
   mentionUsers: { type: [String], immutable: true },
   sentTime: {
      type: Date,
      required: function(v) {
         return this.status === REPORT_HISTORY_STATUS.SUCCEED
      }
   },
   content: {
      type: String,
      required: function(v) {
         return this.status !== REPORT_HISTORY_STATUS.PENDING
      }
   },
   status: { type: String, enum: Object.values(REPORT_HISTORY_STATUS), required: true }
}, { timestamps: true })

const ReportHistory = mongoose.model('ReportHistory', ReportHistorySchema)

export { ReportHistory, REPORT_HISTORY_STATUS }
