import mongoose from 'mongoose'

const SlackbotApiTokenSchema = new mongoose.Schema({
   userId: { type: String, required: true },
   userName: { type: String, required: true },
   token: { type: String, required: true }
})

const SlackbotApiToken = mongoose.model('user_api_tokens_poc', SlackbotApiTokenSchema)

export { SlackbotApiToken }
