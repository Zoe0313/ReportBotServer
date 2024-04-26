import mongoose from 'mongoose'
import logger from '../../common/logger.js'

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

const UpdateUserInfo = async (userInfoList) => {
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

const FindUserInfoByName = async (userName) => {
   const userInfo = await UserInfo.findOne({ userName: userName })
   if (userInfo == null || userInfo.slackId == null || userInfo.slackId === '') {
      logger.debug(`the user ${userName} not found in db. Search info by Slack API.`)
      return null
   }
   return userInfo
}

const GetVMwareIdBySlackId = async (slackId) => {
   const userInfo = await UserInfo.findOne({ slackId: slackId })
   if (userInfo == null || userInfo.userName == null || userInfo.userName === '') {
      logger.debug(`Fail to query VMware ID by slack ID ${slackId} in db.`)
      return null
   }
   return userInfo.userName
}

export { UserInfo, UpdateUserInfo, FindUserInfoByName, GetVMwareIdBySlackId }
