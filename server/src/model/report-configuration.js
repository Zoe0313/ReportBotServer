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
   conversations: { type: [String], required: true },
   mentionUsers: [String],
   reportLink: String,
   repeatConfig: {
      repeatType: { type: String, enum: REPEAT_TYPE_ENUM, required: true },
      tz: { type: String, default: 'Asia/Shanghai', required: true },
      startDate: { type: Date },
      endDate: { type: Date },
      cronExpression: String,
      date: String,
      time: String,
      dayOfMonth: { type: Number, min: 1, max: 31 },
      dayOfWeek: { type: [Number] },
      minsOfHour: { type: Number, min: 0, max: 59 }
   }
}, { timestamps: true })

const ReportConfiguration = mongoose.model('ReportConfiguration', ReportConfigurationSchema)

export { ReportConfiguration, REPORT_STATUS }

// {
//    "text": {
//       "type": "plain_text",
//       "text": "Perforce",
//       "emoji": true
//    },
//    "value": "perforce"
// },
// {
//    "text": {
//       "type": "plain_text",
//       "text": "SVS",
//       "emoji": true
//    },
//    "value": "svs"
// },
// {
//    "text": {
//       "type": "plain_text",
//       "text": "FastSVS",
//       "emoji": true
//    },
//    "value": "fastsvs"
// },
// {
//    "text": {
//       "type": "plain_text",
//       "text": "Text",
//       "emoji": true
//    },
//    "value": "text"
// },
// {
//    "text": {
//       "type": "plain_text",
//       "text": "Customized report",
//       "emoji": true
//    },
//    "value": "customized"
// }