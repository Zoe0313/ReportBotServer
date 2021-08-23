import mongoose from 'mongoose'
import cronParser from 'cron-parser'
import parseUrl from 'parse-url'
import axios from 'axios'
import logger from '../../common/logger.js'

const REPORT_STATUS = {
   CREATED: 'CREATED',
   DRAFT: 'DRAFT',
   DISABLED: 'DISABLED',
   ENABLED: 'ENABLED'
}

const STATUS_ENUM = Object.values(REPORT_STATUS)
const REPORT_TYPE_ENUM = ['bugzilla', 'perforce', 'svs', 'fastsvs', 'text', 'customized']
const REPEAT_TYPE_ENUM = ['not_repeat', 'hourly', 'daily', 'weekly', 'monthly', 'cron_expression']

const URL_REGEX = /((http|https):\/\/)[\w-]+(\.[\w-]+)+([\w.,@?^=%&amp;:/~+#-]*[\w@?^=%&amp;/~+#-])?/
const TIME_REGEX = /^([0-1]?[0-9]|2[0-4]):([0-5][0-9])(:[0-5][0-9])?$/
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

const ReportConfigurationSchema = new mongoose.Schema({
   title: { type: String, required: true },
   creator: { type: String, required: true },
   status: { type: String, enum: STATUS_ENUM, required: true },
   reportType: { type: String, enum: REPORT_TYPE_ENUM, required: true },
   conversations: {
      type: [String],
      validate: {
         validator: function(v) {
            return v?.length > 0
         },
         message: () => `Should select at least one conversation to send report.`
      }
   },
   mentionUsers: [String],
   reportSpecConfig: {
      bugzillaLink: {
         type: String,
         required: function(v) {
            return this.reportType === 'bugzilla'
         },
         validate: {
            validator: async function(v) {
               if (v == null) {
                  return true
               }
               let link = v
               if (v.includes('via.vmw.com')) {
                  try {
                     const res = await axios.get(v, {
                        maxRedirects: 0,
                        validateStatus: function (status) {
                           return status >= 200 && status <= 302
                        }
                     })
                     if (res.headers.location != null) {
                        link = res.headers.location
                     } else {
                        throw new Error(`failed to get the original link of ${v}.`)
                     }
                  } catch (e) {
                     logger.warn(e)
                     throw new Error(`Parse the original link of ${v} failed. Please try again or use original link directly.`)
                  }
               }
               const url = parseUrl(link)
               logger.info(JSON.stringify(url))
               if (url.resource === 'bugzilla.eng.vmware.com') {
                  if (url.protocol === 'https' && url.pathname === '/report.cgi' &&
                     url.search.includes('format=table')) {
                     return true
                  } else {
                     throw new Error(`Unsupported bugzilla url. It should be started with 'https://bugzilla.eng.vmware.com/report.cgi?format=table'`)
                  }
               } else {
                  throw new Error(`Unsupported link. Now we only support 'bugzilla.eng.vmware.com/report.cgi?format=table...'`)
               }
            }
         }
      }
   },
   repeatConfig: {
      repeatType: { type: String, enum: REPEAT_TYPE_ENUM, required: true },
      tz: { type: String, default: 'Asia/Shanghai', required: true },
      startDate: {
         type: Date,
         validate: {
            validator: function(startDate) {
               const today = new Date()
               today.setHours(0, 0, 0, 0)
               return !startDate ||
                  (!this.repeatConfig.endDate || startDate < this.repeatConfig.endDate)
            },
            message: () => `It should be less than end date.`
         }
      },
      endDate: {
         type: Date,
         validate: {
            validator: function(endDate) {
               const today = new Date()
               today.setHours(0, 0, 0, 0)
               return !endDate || (endDate >= today &&
                  (!this.repeatConfig.startDate || this.repeatConfig.startDate < endDate))
            },
            message: () => `It should be greater than or equal to today, and greater than start date.`
         }
      },
      cronExpression: {
         type: String,
         required: function(v) {
            return this.repeatConfig.repeatType === 'cron_expression'
         },
         validate: {
            validator: function(v) {
               try {
                  return !v || cronParser.parseExpression(v)
               } catch (e) {
                  return false
               }
            },
            message: props => `${props.value} is not a valid cron expression. It should like '30 14 * * 2'.`
         }
      },
      date: {
         type: String,
         required: function(v) {
            return this.repeatConfig.repeatType === 'not_repeat'
         },
         validate: {
            validator: function(v) {
               return !v || DATE_REGEX.test(v)
            },
            message: props => `${props.value} is not a valid date. It should be YYYY-MM-DD format.`
         }
      },
      time: {
         type: String,
         required: function(v) {
            return ['not_repeat', 'daily', 'weekly', 'monthly']
               .includes(this.repeatConfig.repeatType)
         },
         validate: {
            validator: function(v) {
               return !v || TIME_REGEX.test(v)
            },
            message: props => `${props.value} is not a valid time. It should be HH:mm format.`
         }
      },
      dayOfMonth: {
         type: Number,
         set: v => (v ? parseInt(v) : null),
         required: function(v) {
            return this.repeatConfig.repeatType === 'monthly'
         },
         min: [1, 'Day of month should be greater than or equal to 1'],
         max: [31, 'Day of month should be less than or equal to 31']
      },
      dayOfWeek: {
         type: [Number],
         set: v => v ? v.map(item => (item ? parseInt(item) : null)) : null,
         validate: {
            validator: function(v) {
               return this.repeatConfig.repeatType !== 'weekly' || v?.length > 0
            },
            message: props => `Should select at least one day of week.`
         },
         enum: [0, 1, 2, 3, 4, 5, 6]
      },
      minsOfHour: {
         type: Number,
         set: v => (v ? parseInt(v) : null),
         required: function(v) {
            return this.repeatConfig.repeatType === 'hourly'
         },
         min: [0, 'Day of month should be greater than or equal to 0'],
         max: [59, 'Day of month should be less than or equal to 59']
      }
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
