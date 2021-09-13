import mongoose from 'mongoose'

const SlackbotApiTokenSchema = new mongoose.Schema({
	id: { type: String, required: true },
   token: { type: String, required: true },
})

const SlackbotApiToken = mongoose.model('user_api_tokens_poc', SlackbotApiTokenSchema)

export { SlackbotApiToken }
