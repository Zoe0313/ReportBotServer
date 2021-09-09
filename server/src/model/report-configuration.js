import mongoose from 'mongoose'
import cronParser from 'cron-parser'
import parseUrl from 'parse-url'
import axios from 'axios'
import logger from '../../common/logger.js'
import {
   verifyBotInChannel, getUsersName
} from '../../common/slack-helper.js'
import { PerforceInfo } from './perforce-info.js'

const REPORT_STATUS = {
   CREATED: 'CREATED',
   DRAFT: 'DRAFT',
   DISABLED: 'DISABLED',
   ENABLED: 'ENABLED'
}

const STATUS_ENUM = Object.values(REPORT_STATUS)
const REPORT_TYPE_ENUM = ['bugzilla', 'perforce_checkin', 'svs', 'fastsvs', 'text', 'customized']
const REPEAT_TYPE_ENUM = ['not_repeat', 'hourly', 'daily', 'weekly', 'monthly', 'cron_expression']

const TIME_REGEX = /^([0-1]?[0-9]|2[0-4]):([0-5][0-9])(:[0-5][0-9])?$/
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

const PerforceCheckInMembersFilterSchema = new mongoose.Schema({
   members: {
      type: [String],
      required: true
   },
   condition: {
      type: String,
      enum: ['include', 'exclude'],
      required: true
   },
   type: {
      type: String,
      enum: ['selected', 'direct_reporters', 'all_reporters'],
      required: true
   }
})

const ReportConfigurationSchema = new mongoose.Schema({
   title: { type: String, required: true },
   creator: { type: String, required: true },
   status: { type: String, enum: STATUS_ENUM, required: true },
   reportType: { type: String, enum: REPORT_TYPE_ENUM, required: true },
   conversations: {
      type: [String],
      validate: {
         validator: async function(v) {
            if (!v || v.length === 0) {
               throw new Error(`Should select at least one channel/direct message to send report.`)
            } else {
               const results = await Promise.all(
                  v.filter(channel => channel.startsWith('C')).map(channel =>
                     verifyBotInChannel(channel)
                        .then(inChannel => ({ channel, inChannel }))
                  )
               )
               const notInChannelList = results.filter(result => !result.inChannel)
                  .map(result => result.channel)
               if (notInChannelList.length > 0) {
                  throw new Error('I am not in some selected private channel(s), ' +
                     'please invite me into the channel(s).')
               }
            }
         }
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
                     throw new Error(`Parse the original link of ${v} failed. ` +
                        `Please try again or use original link directly. ` +
                        `Refer to https://bugzilla.eng.vmware.com/query.cgi?format=report-table`)
                  }
               }
               const url = parseUrl(link)
               if (url.resource === 'bugzilla.eng.vmware.com') {
                  if (url.protocol === 'https' && url.pathname === '/report.cgi' &&
                     url.search.includes('format=table')) {
                     return true
                  }
               }
               throw new Error(`Unsupported bugzilla url.\n` +
                  `Currently we only support bugzilla tabular report. ` +
                  `Refer to https://bugzilla.eng.vmware.com/query.cgi?format=report-table ` +
                  `for creating the bugzilla tabular report and generate the link.'`)
            }
         }
      },
      text: {
         type: String,
         required: function(v) {
            return this.reportType === 'text'
         },
         validate: {
            validator: async function(v) {
               if (v == null) {
                  return true
               }
               return v.length > 0 && v.length <= 2000
            },
            message: 'The length of text message should greater than 0 and less than 2000.'
         }
      },
      perforceCheckIn: {
         membersFilters: {
            type: [PerforceCheckInMembersFilterSchema],
            validate: {
               validator: function(v) {
                  return this.repeatConfig.repeatType !== 'perforce_checkin' || v?.length > 0
               },
               message: `Should select at least one member filters when use perforce checkin report type.`
            }
         },
         flattenMembers: { // flatten members will be computed by members filters
            type: [String]
         },
         branches: {
            type: [String],
            required: function(v) {
               return this.reportType === 'perforce_checkin'
            },
            validate: {
               validator: async function(v) {
                  if (v == null) {
                     return true
                  }
                  let allBranches = []
                  try {
                     allBranches = (await PerforceInfo.find())
                        .map(perforceInfo => {
                           return perforceInfo.branches
                              .map(branch => `${perforceInfo.project}/${branch}`)
                        }).flat()
                  } catch (e) {
                     logger.error(e)
                     throw new Error(`Internal server error, please contact developers.`)
                  }
                  const notExistBranches = v.filter(branch => !allBranches.includes(branch))
                  if (notExistBranches.length > 0) {
                     throw new Error(`${notExistBranches.join(',')} are not belonged to selected project.`)
                  }
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
            message: `It should be greater than or equal to today, and greater than start date.`
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
            message: `Should select at least one day of week.`
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

// get direct reporters username of given members through LDAP API
const getDirectReporters = async (members) => {
   return await Promise.all(members.map(member => {
      const body = {
         _source: ['username'],
         from: 0,
         size: 1000,
         query: {
            match: {
               direct_manager_username: member
            }
         }
      }
      return axios.post('https://ldap-data.svc-stage.eng.vmware.com/ldap/_search', body)
         .then(res => {
            // avoid someone report to himself in case causing endless loop
            return res.data.hits?.hits?.map(hit => hit._source.username)
               ?.filter(user => !members.includes(user)) || []
         })
   })).then(membersList => membersList.flat())
}

// flatten p4 checkin members based on members filters
const flattenPerforceCheckinMembers = async (membersFilters) => {
   if (membersFilters == null || membersFilters.length === 0) {
      return []
   }
   logger.debug(`flatten members from members filters ${JSON.stringify(membersFilters)}`)
   const members = (await Promise.all(membersFilters.map(membersFilter => {
      if (membersFilter.type === 'selected') {
         // get users name from users slack id
         return getUsersName(membersFilter.members).then(selectedMembers => {
            return {
               condition: membersFilter.condition,
               members: selectedMembers
            }
         })
      } else if (membersFilter.type === 'direct_reporters') {
         return getUsersName(membersFilter.members).then(selectedMembers => {
            return getDirectReporters(selectedMembers)
               .then(directReporters => ({
                  condition: membersFilter.condition,
                  // including direct reporters and selected members
                  members: directReporters.concat(selectedMembers)
               }))
         })
      } else if (membersFilter.type === 'all_reporters') {
         // recursive function of getting all reports by given members
         const getAllReporters = async (members, startTime) => {
            if (members == null || members.length === 0 ||
               // if timeout, then return directly
               new Date().getTime() - startTime > 10 * 60 * 1000) {
               return []
            }
            const directReporters = await getDirectReporters(members)
            // including all reporters and selected members
            return members.concat(await getAllReporters(directReporters, startTime))
         }
         return getUsersName(membersFilter.members).then(selectedMembers => {
            return getAllReporters(selectedMembers, new Date().getTime()).then(allReporters => {
               return {
                  condition: membersFilter.condition,
                  members: allReporters
               }
            })
         })
      } else {
         throw new Error('invalid member filter type')
      }
   }))).reduce((acc, curVal) => {
      if (curVal.condition === 'include') {
         return [...new Set(acc.concat(curVal.members))]
      } else if (curVal.condition === 'exclude') {
         return acc.filter(member => !curVal.members.includes(member))
      } else {
         throw new Error('invalid member filter condition')
      }
   }, [])
   logger.debug(`get all flatten members ${JSON.stringify(members)}`)
   return members
}

export { ReportConfiguration, REPORT_STATUS, flattenPerforceCheckinMembers }

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
//       "text": "Customized report",
//       "emoji": true
//    },
//    "value": "customized"
// }
