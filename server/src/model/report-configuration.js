import mongoose from 'mongoose'
import cronParser from 'cron-parser'
import parseUrl from 'parse-url'
import axios from 'axios'
import https from 'https'
import logger from '../../common/logger.js'
import { PerforceInfo } from './perforce-info.js'

const REPORT_STATUS = {
   CREATED: 'CREATED',
   DRAFT: 'DRAFT',
   DISABLED: 'DISABLED',
   ENABLED: 'ENABLED',
   REMOVED: 'REMOVED'
}

const STATUS_ENUM = Object.values(REPORT_STATUS)
const REPORT_TYPE_ENUM = [
   'bugzilla',
   'perforce_checkin',
   'svs',
   'text',
   'customized',
   'bugzilla_by_assignee',
   'perforce_review_check',
   'nanny_reminder',
   'jira_list'
]
const REPEAT_TYPE_ENUM = ['not_repeat', 'hourly', 'daily', 'weekly', 'monthly', 'cron_expression']

const TIME_REGEX = /^([0-1]?[0-9]|2[0-4]):([0-5][0-9])(:[0-5][0-9])?$/
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

const YES_OR_NO_ENUM = ['Yes', 'No']

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
   creator: { type: String, required: true }, // the account of <account>@broadcom.com
   status: { type: String, enum: STATUS_ENUM, required: true },
   reportType: { type: String, enum: REPORT_TYPE_ENUM, required: true },
   conversations: [String],
   mentionUsers: [String],
   mentionGroups: [Object],
   skipEmptyReport: {
      type: String,
      required: function(v) {
         return this.reportType === 'bugzilla' ||
            this.reportType === 'perforce_checkin' ||
            this.reportType === 'bugzilla_by_assignee' ||
            this.reportType === 'jira_list'
      },
      enum: YES_OR_NO_ENUM
   },
   webhooks: { type: [String], required: true },
   reportSpecConfig: {
      bugzillaList2Table: {
         type: String,
         enum: YES_OR_NO_ENUM
      },
      foldBugzillaList: {
         type: String,
         enum: YES_OR_NO_ENUM
      },
      sendIfPRDiff: {
         type: String,
         enum: YES_OR_NO_ENUM
      },
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
               if (v.includes('vsanvia.broadcom.net')) {
                  try {
                     const res = await axios.get(v, {
                        maxRedirects: 0,
                        validateStatus: function (status) {
                           return status >= 200 && status <= 303
                        },
                        httpsAgent: new https.Agent({ rejectUnauthorized: false })
                     })
                     if (res.headers.location != null) {
                        link = res.headers.location
                        logger.debug(`original link is: ${link}`)
                     } else {
                        throw new Error(`failed to get the original link of ${v}.`)
                     }
                  } catch (e) {
                     logger.warn(e)
                     throw new Error(`Parse the original link of ${v} failed. ` +
                        `Please try again or use original link directly. ` +
                        `Refer to https://bugzilla.eng.vmware.com/query.cgi?format=report-table for tabular table ` +
                        `or https://bugzilla.eng.vmware.com/query.cgi? for bug list.`)
                  }
               }
               const url = parseUrl(link)
               if (url.resource === 'bugzilla-vcf.lvn.broadcom.net') {
                  if (url.protocol === 'https') {
                     if ((url.pathname === '/report.cgi' && url.search.includes('format=table')) ||
                        (url.pathname === '/buglist.cgi')) {
                        return true
                     }
                  }
               }
               throw new Error(`Unsupported bugzilla url.\n` +
                  `Refer to the hint as below for creating a bugzilla report.'`)
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
            message: 'The length of text message should be greater than 0 and less than 2000.'
         }
      },
      perforceCheckIn: {
         membersFilters: {
            type: [PerforceCheckInMembersFilterSchema]
         },
         flattenMembers: { // flatten members will be computed by members filters
            type: [String]
         },
         teams: {
            type: [String]
         },
         needCheckinApproved: {
            type: String,
            required: function(v) {
               return this.reportType === 'perforce_checkin'
            },
            enum: YES_OR_NO_ENUM
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
      },
      perforceReviewCheck: {
         membersFilters: {
            type: [PerforceCheckInMembersFilterSchema]
         },
         flattenMembers: { // flatten members will be computed by members filters
            type: [String]
         },
         teams: {
            type: [String]
         },
         branches: {
            type: [String],
            required: function(v) {
               return this.reportType === 'perforce_review_check'
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
      },
      bugzillaAssignee: {
         type: [String],
         required: function(v) {
            return this.reportType === 'bugzilla_by_assignee'
         },
         validate: {
            validator: async function(v) {
               if (v == null) {
                  return true
               }
               return v.length >= 0 && v.length <= 50
            },
            message: 'The number of bugzilla assignee should be greater than 0 and less than 50.'
         }
      },
      nannyCode: {
         type: String
      },
      nannyAssignee: {
         type: String,
         required: function(v) {
            return this.reportType === 'nanny_reminder'
         },
         validate: {
            validator: function(v) {
               if (v == null || this.reportType !== 'nanny_reminder') {
                  return true
               }
               const assignees = v.split('\n')
               return assignees.length >= 2
            },
            message: 'The number of nanny assignees should be greater than 1.'
         }
      },
      nannyRoster: {
         type: String,
         required: function(v) {
            return this.reportType === 'nanny_reminder'
         }
      },
      jira: {
         jql: {
            type: String,
            required: function(v) {
               return this.reportType === 'jira_list'
            },
            validate: {
               validator: async function(queryStr) {
                  if (queryStr == null) {
                     return true
                  }
                  try {
                     logger.debug(`input fields=${fields}`)
                     const res = await axios({
                        method: 'get',
                        url: 'https://vmw-jira.broadcom.net/rest/api/2/search',
                        headers: {
                           Authorization: `Bearer ${process.env.JIRA_ACCESS_TOKEN}`
                        },
                        data: {
                           jql: queryStr,
                           startAt: 0,
                           maxResults: 1,
                           fields: ['id', 'key']
                        }
                     })
                     if (res.status === 200) {
                        if (fields.length > 0 && res.data?.total > 0) {
                           const issueFields = res.data?.issues[0]?.fields
                           if (issueFields != null && typeof issueFields !== 'undefined') {
                              const notFoundFields = fields.filter(field => {
                                 return !Object.prototype.hasOwnProperty.call(issueFields, field)
                              })
                              if (notFoundFields.length > 0) {
                                 throw new Error(`not found fields "${notFoundFields.toString()}"`)
                              }
                           } else {
                              throw new Error(`not found fields "${fields.toString()}"`)
                           }
                        }
                        return true
                     }
                  } catch (e) {
                     logger.warn(e)
                     throw new Error(`Failed to parse the JQL because ${e.message}. ` +
                        'Please check your JQL in https://vmw-jira.broadcom.net/issues?jql=' +
                        ' or adjust your custom fields.')
                  }
               }
            }
         },
         fields: {
            type: [String],
            required: function(v) {
               return this.reportType === 'jira_list'
            }
         },
         groupby: {
            type: String,
            required: function(v) {
               return this.reportType === 'jira_list'
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
   },
   adminConfig: {
      channels: { type: [String] }
   }
}, { timestamps: true })

const ReportConfiguration = mongoose.model('ReportConfiguration', ReportConfigurationSchema)

// get direct reporters username of given members through LDAP API
const GetDirectReporters = async (members) => {
   return await Promise.all(members.map(member => {
      return axios.get('https://nimbus-api.vdp.lvn.broadcom.net/api/v1/users/' + member)
         .then(res => {
            // avoid someone report to himself in case causing endless loop
            return res.data.direct_reports
               ?.filter(user => !members.includes(user)) || []
         })
   })).then(membersList => membersList.flat())
}

// flatten p4 checkin members based on members filters
const FlattenMembers = async (membersFilters, selectedTeamsMembers) => {
   if (membersFilters == null || membersFilters.length === 0) {
      return selectedTeamsMembers
   }
   logger.debug(`flatten members from members filters ${JSON.stringify(membersFilters)}`)
   // sort filters to make all include filters be in front of exclude filters
   const members = (await Promise.all(
      membersFilters
         .sort((filter1, filter2) => filter1.condition === 'include' ?  -1 : 1)
         .map(async membersFilter => {
            if (membersFilter.type === 'selected') {
               // get users name from users slack id
               return {
                  condition: membersFilter.condition,
                  members: [].concat(membersFilter.members)
               }
            } else if (membersFilter.type === 'direct_reporters') {
               const selectedMembers = [].concat(membersFilter.members)
               const directReporters = await GetDirectReporters(selectedMembers)
               return {
                  condition: membersFilter.condition,
                  members: directReporters.concat(selectedMembers)
               }
            } else if (membersFilter.type === 'all_reporters') {
               // recursive function of getting all reports by given members
               const getAllReporters = async (members, startTime) => {
                  const timeElapsed = () => new Date().getTime() - startTime
                  // if timeout, then return directly
                  if (members == null || members.length === 0 || timeElapsed() > 10 * 60 * 1000) {
                     return []
                  }
                  const directReporters = await GetDirectReporters(members)
                  // including all reporters and selected members
                  return members.concat(await getAllReporters(directReporters, startTime))
               }
               const selectedMembers = [].concat(membersFilter.members)
               const allReporters = await getAllReporters(selectedMembers, new Date().getTime())
               return {
                  condition: membersFilter.condition,
                  members: allReporters
               }
            } else {
               throw new Error('invalid member filter type')
            }
         })
   )).reduce((acc, curVal) => {
      // calculate all included members at first
      if (curVal.condition === 'include') {
         return [...new Set(acc.concat(curVal.members))]
      } else if (curVal.condition === 'exclude') {
         // then delete all excluded members
         return acc.filter(member => !curVal.members.includes(member))
      } else {
         throw new Error('invalid member filter condition')
      }
   }, [...new Set(selectedTeamsMembers)])
   logger.debug(`get all flatten members ${JSON.stringify(members)}`)
   return members
}

export {
   ReportConfiguration,
   PerforceCheckInMembersFilterSchema,
   REPORT_STATUS,
   FlattenMembers
}
