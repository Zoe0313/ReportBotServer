import mongoose from 'mongoose'

const ReportHistorySchema = new mongoose.Schema({
   reportConfigId: { type: mongoose.ObjectId, required: true, immutable: true },
   title: { type: String, required: true, immutable: true },
   creator: { type: String, required: true, immutable: true },
   reportType: { type: String, required: true, immutable: true },
   conversations: { type: [String], immutable: true },
   reportUsers: { type: [String], immutable: true },
   sentTime: { type: Date, immutable: true },
   content: { type: String, immutable: true },
   result: { type: Boolean, immutable: true }
}, { timestamps: true })

const ReportHistory = mongoose.model('ReportHistory', ReportHistorySchema)

export { ReportHistory }