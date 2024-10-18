import mongoose from 'mongoose'
import path from 'path'
import fs from 'fs'
import axios from 'axios'
import logger from '../../common/logger.js'
import { TeamGroup } from './team-group.js'

const MailInfoSchema = new mongoose.Schema({
   oktaId: { type: String, required: true },
   mail: { type: String, required: true },
   fullName: { type: String, required: true },
   manager: {type: String, required: true },
   gid: { type: String, required: false },
   vmwareId: { type: String, required: false }
}, { timestamps: true })

const MailInfo = mongoose.model('MailInfo', MailInfoSchema)

const JsonFile = path.join(path.resolve(), '..') + `/persist/config/google-okta-id.json`
const JsonCache = JSON.parse(fs.readFileSync(JsonFile))

const UpdateMailList = async () => {
   const api = 'https://nimbus-api.vdp.lvn.broadcom.net/api/v1/users/'
   const team = await TeamGroup.findOne({ code: 'vsan-all' })
   if (!team || !team.members || team.members.length === 0) {
      logger.warn('No members found in team vsan-all')
      return
   }
   await Promise.all(team.members.map(async oktaId => {
      const existMailInfo = await MailInfo.findOne({ oktaId })
      if (existMailInfo == null) {
         const url = api + oktaId
         try {
            const res = await axios.get(url)
            const data = res.data
            const mailInfo = new MailInfo({
               oktaId: data.user,
               mail: data.mail,
               fullName: data.display_name,
               manager: data.manager,
               gid: JsonCache[oktaId]?.gid || '',
               vmwareId: JsonCache[oktaId]?.vmwareId || ''
            })
            await mailInfo.save()
         } catch (error) {
            logger.error(`Failed to fetch data for user ${oktaId}: ${error.message}`)
         }
      }
   }))
   const userCount = await MailInfo.countDocuments()
   logger.info(`Fetch data for all vsan user is completed. size: ${userCount}`)
}

const QueryUserInfoByName = async (account) => {
   if (account == null || account === '' || typeof account == 'undefined') {
      return null
   }
   const mailAccount = account.split('@')[0] + '@broadcom.com'
   const mailInfo = await MailInfo.findOne({ mail: mailAccount })
   if (mailInfo == null || mailInfo.oktaId == null) {
      logger.debug(`Fail to query mail info by ${mailAccount} in db.mailinfos`)
      return null
   }
   return mailInfo
}

export { MailInfo, UpdateMailList, QueryUserInfoByName }