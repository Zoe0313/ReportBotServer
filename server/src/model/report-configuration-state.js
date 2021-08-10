import mongoose from 'mongoose'

// page: 1,
// channel: null,
// selected: null,
// filterBlockId: 1 // dynamic block id to implement clear filters

const ReportConfigurationStateSchema = new mongoose.Schema({
    ts: { type: String },
    page: { type: Number, required: true },
    count: { type: Number },
    channel: { type: String },
    selectedId: { type: String }
}, { timestamps: true })

ReportConfigurationStateSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 })

const ReportConfigurationState = mongoose.model('ReportConfigurationState', ReportConfigurationStateSchema);

export { ReportConfigurationState }