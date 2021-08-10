import mongoose from 'mongoose'

const REPORT_STATUS = {
    CREATED: 'CREATED', 
    DRAFT: 'DRAFT', 
    DISABLED: 'DISABLED', 
    ENABLED: 'ENABLED', 
}

const STATUS_ENUM = Object.values(REPORT_STATUS)
const REPORT_TYPE_ENUM = ['bugzilla', 'perforce', 'svs', 'fastsvs', 'text', 'customized']
const REPEAT_TYPE_ENUM = ['not_repeat', 'hourly', 'daily', 'weekly', 'monthly', 'cron_expression']

const ReportConfigurationSchema = new mongoose.Schema({
    title: { type: String, required: true },
    creator: { type: String, required: true },
    status: { type: String, enum: STATUS_ENUM, required: true },
    reportType: { type: String, enum: REPORT_TYPE_ENUM, required: true },
    conversations: [String],
    reportUsers: [String],
    reportLink: String,
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, default: Date.now },
    repeatConfig: {
        repeatType: { type: String, enum: REPEAT_TYPE_ENUM, required: true },
        cronExpression: String,
        date: Date,
        time: String,
        dayOfMonth: { type: Number, min: 1, max : 31 },
        dayOfWeek: { type: [Number] },
        minsOfHour: { type: Number, min: 0, max : 59 }
    }
}, { timestamps: true })

const ReportConfiguration = mongoose.model('ReportConfiguration', ReportConfigurationSchema);

export { ReportConfiguration, REPORT_STATUS }