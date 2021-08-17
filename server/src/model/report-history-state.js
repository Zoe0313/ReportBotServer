import mongoose from 'mongoose'

const ReportHistoryStateSchema = new mongoose.Schema({
   ts: { type: String },
   page: { type: Number, required: true },
   count: { type: Number },
   filterBlockId: { type: Number, required: true },
   channel: { type: String },
   selectedId: { type: String }
}, { timestamps: true })

ReportHistoryStateSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 })

const ReportHistoryState = mongoose.model('ReportHistoryState', ReportHistoryStateSchema)

export { ReportHistoryState }