import mongoose from 'mongoose'
import logger from '../../common/logger.js'
import { getUserList } from '../../common/slack-helper.js'

const UserInfoSchema = new mongoose.Schema({
   userName: {
      type: String,
      required: true
   },
   fullName: {
      type: String,
      required: true
   },
   slackId: {
      type: String,
      require: true
   }

}, { timestamps: true })

const UserInfo = mongoose.model('UserInfo', UserInfoSchema)

const updateUserInfo = async (userInfoList) => {
   // update the user info in db
   logger.info('Start to update Slack user info.')
   if (userInfoList == null || userInfoList.length === 0) {
      logger.debug(`Invalid user info list, skip the update.`)
      return
   }
   await Promise.all(userInfoList.map(user => {
      return UserInfo.findOneAndUpdate({ slackId: user.slackId }, {
         userName: user.userName,
         fullName: user.fullName,
         slackId: user.slackId
      }, { upsert: true })
   }))
   logger.info(`Updated slack users information in db.`)
}

export { UserInfo, updateUserInfo }
